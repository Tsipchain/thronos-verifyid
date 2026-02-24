import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Video, VideoOff, Mic, MicOff, PhoneOff,
  CheckCircle, XCircle, Loader2, FileText,
  ArrowLeftRight, User,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallDetails {
  id: number;
  verification_id: number;
  customer_id: string;
  status: string;
}

interface VerificationDetails {
  id: number;
  document_type: string;
  document_image_url: string | null;
  extracted_data: string | null;
  full_name: string | null;
  document_number: string | null;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentVideoCall() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [callDetails, setCallDetails] = useState<CallDetails | null>(null);
  const [verification, setVerification] = useState<VerificationDetails | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [pipSwapped, setPipSwapped] = useState(false); // false = remote is main, local is PiP
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [callState, setCallState] = useState<'connecting' | 'in_call'>('connecting');
  const [completing, setCompleting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Two video elements: main (big) and pip (small overlay)
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // ── Sync video elements with streams + swap state ──────────────────────────
  useEffect(() => {
    const mainStream = pipSwapped ? localStreamRef.current : remoteStreamRef.current;
    const pipStream  = pipSwapped ? remoteStreamRef.current : localStreamRef.current;
    if (mainVideoRef.current) mainVideoRef.current.srcObject = mainStream;
    if (pipVideoRef.current)  pipVideoRef.current.srcObject  = pipStream;
  }, [pipSwapped, localStream, remoteStream]);

  // ── Camera setup ──────────────────────────────────────────────────────────
  const startLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraError(null);
      return stream;
    } catch (err: any) {
      const msg = err.name === 'NotAllowedError'
        ? 'Camera/microphone access denied. Please allow access in your browser settings.'
        : 'Could not access camera or microphone.';
      setCameraError(msg);
      toast({ title: 'Camera Error', description: msg, variant: 'destructive' });
      return null;
    }
  }, [toast]);

  // ── WebRTC helpers ────────────────────────────────────────────────────────
  const createPeerConnection = useCallback((stream: MediaStream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.ontrack = (event) => {
      const [remote] = event.streams;
      remoteStreamRef.current = remote;
      setRemoteStream(remote);
      setCallState('in_call');
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice_candidate',
          candidate: event.candidate,
          call_id: Number(callId),
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setCallState('in_call');
    };

    return pc;
  }, [callId]);

  const sendOffer = useCallback(async (stream: MediaStream) => {
    const pc = createPeerConnection(stream);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsRef.current?.send(JSON.stringify({
        type: 'offer',
        offer: pc.localDescription,
        call_id: Number(callId),
      }));
    } catch (e) {
      console.error('Offer error:', e);
    }
  }, [callId, createPeerConnection]);

  // ── WebSocket signaling ───────────────────────────────────────────────────
  const connectSignaling = useCallback((userId: string, stream: MediaStream) => {
    const base = getAPIBaseURL();
    const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
    const ws = new WebSocket(`${wsBase}/api/v1/video-calls/ws/${userId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join_call', call_id: Number(callId), role: 'agent' }));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      const pc = pcRef.current;

      switch (msg.type) {
        case 'call_joined':
          // Server confirmed join; if client is already in room → offer immediately
          if (msg.existing_peers?.length > 0) {
            await sendOffer(stream);
          }
          break;

        case 'peer_joined':
          // Client just connected → send offer
          await sendOffer(stream);
          break;

        case 'answer':
          if (pc && pc.signalingState !== 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
          }
          break;

        case 'ice_candidate':
          if (pc) {
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
          }
          break;

        case 'peer_left':
          setCallState('connecting');
          setRemoteStream(null);
          remoteStreamRef.current = null;
          break;
      }
    };

    ws.onerror = () => toast({ title: 'Connection error', description: 'Signaling lost', variant: 'destructive' });
  }, [callId, sendOffer, toast]);

  // ── Initialise ────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      if (!callId) return;
      try {
        const callRes = await apiClient.get<CallDetails>(`/api/v1/video-calls/${callId}`).catch(() => null);
        if (callRes) {
          setCallDetails(callRes.data);
          const verRes = await apiClient.get<VerificationDetails>(
            `/api/v1/verifications/${callRes.data.verification_id}`,
          ).catch(() => null);
          if (verRes) setVerification(verRes.data);
        }

        const stream = await startLocalStream();
        if (!stream) return;

        const userRes = await apiClient.get<{ id: string }>('/api/v1/auth/me');
        connectSignaling(userRes.data.id, stream);
      } catch (err) {
        console.error('Init error:', err);
      }
    };
    init();

    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsVideoOn((v) => !v);
  };

  const toggleAudio = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsAudioOn((a) => !a);
  };

  const hangUp = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    wsRef.current?.close();
    navigate('/agent');
  };

  const completeCall = async (outcome: 'approved' | 'rejected') => {
    if (!callId) return;
    setCompleting(true);
    try {
      await apiClient.post(`/api/v1/video-calls/${callId}/complete`, {
        outcome,
        notes: `Verification ${outcome} by agent via video call`,
      });
      toast({
        title: outcome === 'approved' ? 'Identity Verified' : 'Verification Rejected',
        description: outcome === 'approved'
          ? 'Client approved. Blockchain anchoring in progress.'
          : 'Verification rejected. Client notified.',
      });
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      wsRef.current?.close();
      navigate('/agent');
    } catch (err: any) {
      toast({ title: 'Error', description: err?.response?.data?.detail || err.message, variant: 'destructive' });
      setCompleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-900/80 border-b border-gray-800 flex-shrink-0">
        <div>
          <h1 className="text-base font-bold leading-tight">Video Verification</h1>
          {callDetails && (
            <p className="text-xs text-gray-400">Call #{callDetails.id}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge className={callState === 'in_call' ? 'bg-green-600 text-xs' : 'bg-yellow-600 text-xs'}>
            {callState === 'in_call' ? 'Connected' : 'Waiting for client…'}
          </Badge>
          <Badge className={localStream ? 'bg-blue-600 text-xs' : 'bg-red-600 text-xs'}>
            {localStream ? 'Camera On' : 'No Camera'}
          </Badge>
        </div>
      </div>

      {cameraError && (
        <div className="mx-4 mt-3 bg-red-900/50 border border-red-600 rounded-lg p-3 text-red-200 text-sm flex-shrink-0">
          {cameraError}
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Video area ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 p-3 gap-3">

          {/* PiP video container */}
          <div className="relative flex-1 bg-gray-900 rounded-2xl overflow-hidden min-h-0">

            {/* Main video (full area) */}
            <video
              ref={mainVideoRef}
              autoPlay
              playsInline
              muted={pipSwapped}           /* mute local preview, never mute remote */
              className="w-full h-full object-cover"
            />

            {/* Placeholder when main is remote and not connected */}
            {!pipSwapped && callState === 'connecting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 pointer-events-none gap-3">
                <User className="h-16 w-16 opacity-30" />
                <p className="text-sm">Waiting for client to connect…</p>
              </div>
            )}

            {/* Main label */}
            <div className="absolute top-3 left-3">
              <Badge variant="secondary" className="text-xs bg-black/50 text-white border-0 backdrop-blur-sm">
                {pipSwapped ? 'You (Agent)' : 'Client'}
              </Badge>
            </div>

            {/* PiP overlay — bottom right */}
            <div className="absolute bottom-3 right-3 w-44 h-28 rounded-xl overflow-hidden shadow-2xl border border-white/20 bg-gray-800 group">
              <video
                ref={pipVideoRef}
                autoPlay
                playsInline
                muted={!pipSwapped}
                className="w-full h-full object-cover"
              />

              {/* No stream placeholder */}
              {(pipSwapped ? !remoteStream : !localStream) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Video className="h-6 w-6 text-gray-500 opacity-40" />
                </div>
              )}

              {/* PiP label */}
              <div className="absolute bottom-1.5 left-1.5">
                <Badge variant="secondary" className="text-[10px] bg-black/60 text-white border-0">
                  {pipSwapped ? 'Client' : 'You'}
                </Badge>
              </div>

              {/* Swap button */}
              <button
                onClick={() => setPipSwapped((s) => !s)}
                title="Swap cameras"
                className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/60 hover:bg-black/90 flex items-center justify-center transition-colors"
              >
                <ArrowLeftRight className="h-3 w-3 text-white" />
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="flex justify-center gap-3 flex-shrink-0">
            <Button
              size="lg"
              variant={isVideoOn ? 'secondary' : 'destructive'}
              onClick={toggleVideo}
              className="rounded-full h-12 w-12 p-0"
              title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
            >
              {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Button>
            <Button
              size="lg"
              variant={isAudioOn ? 'secondary' : 'destructive'}
              onClick={toggleAudio}
              className="rounded-full h-12 w-12 p-0"
              title={isAudioOn ? 'Mute' : 'Unmute'}
            >
              {isAudioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
            <Button
              size="lg"
              variant="destructive"
              onClick={hangUp}
              className="rounded-full h-12 w-12 p-0"
              title="Leave call"
            >
              <PhoneOff className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-3 p-3 overflow-y-auto">

          {/* Document */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <FileText className="h-4 w-4" /> Document
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2">
              {verification ? (
                <>
                  <div className="text-xs text-gray-400 space-y-1">
                    <p><span className="text-gray-300 font-medium">Type:</span> {verification.document_type.replace('_', ' ').toUpperCase()}</p>
                    {verification.full_name && <p><span className="text-gray-300 font-medium">Name:</span> {verification.full_name}</p>}
                    {verification.document_number && <p><span className="text-gray-300 font-medium">Number:</span> {verification.document_number}</p>}
                  </div>
                  {verification.document_image_url ? (
                    <img src={verification.document_image_url} alt="Document front" className="w-full rounded-lg border border-gray-600" />
                  ) : (
                    <p className="text-xs text-gray-500 italic">No image available</p>
                  )}
                  {(() => {
                    try {
                      const data = verification.extracted_data ? JSON.parse(verification.extracted_data) : null;
                      if (data?.back_image_url) return (
                        <>
                          <p className="text-xs text-gray-400 font-medium">Back:</p>
                          <img src={data.back_image_url} alt="Document back" className="w-full rounded-lg border border-gray-600" />
                        </>
                      );
                    } catch { /* ignore */ }
                    return null;
                  })()}
                </>
              ) : (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              )}
            </CardContent>
          </Card>

          {/* Decision */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-sm text-white">Decision</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2">
              <p className="text-xs text-gray-400">Confirm identity matches document before deciding.</p>
              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white h-9"
                disabled={completing}
                onClick={() => completeCall('approved')}
              >
                {completing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Approve
              </Button>
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white h-9"
                disabled={completing}
                variant="destructive"
                onClick={() => completeCall('rejected')}
              >
                {completing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                Reject
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
