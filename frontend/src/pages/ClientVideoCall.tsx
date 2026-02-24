import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { authApi } from '@/lib/auth';
import { getAPIBaseURL } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Video, VideoOff, Mic, MicOff, PhoneOff,
  CheckCircle, XCircle, Loader2, Shield, ArrowLeftRight,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

type CallState = 'connecting' | 'in_call' | 'completed';

interface VerificationResult {
  outcome: 'approved' | 'rejected';
  tx_hash?: string;
}

export default function ClientVideoCall() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [callState, setCallState] = useState<CallState>('connecting');
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [pipSwapped, setPipSwapped] = useState(false); // false = remote (agent) is main

  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Sync video srcObjects ─────────────────────────────────────────────────
  useEffect(() => {
    const mainS = pipSwapped ? localStreamRef.current : remoteStreamRef.current;
    const pipS  = pipSwapped ? remoteStreamRef.current : localStreamRef.current;
    if (mainVideoRef.current) mainVideoRef.current.srcObject = mainS;
    if (pipVideoRef.current)  pipVideoRef.current.srcObject  = pipS;
  }, [pipSwapped, localStream, remoteStream]);

  // ── PeerConnection factory ────────────────────────────────────────────────
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));

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
  };

  // ── Main init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const user = await authApi.getCurrentUser();
      if (!user) { navigate('/login'); return; }

      // Start camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (err: any) {
        const msg = err.name === 'NotAllowedError'
          ? 'Camera/microphone access denied. Please allow access in your browser settings.'
          : 'Could not access camera or microphone.';
        setCameraError(msg);
        toast({ title: 'Camera Error', description: msg, variant: 'destructive' });
      }

      // Connect signaling
      const base = getAPIBaseURL();
      const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
      const ws = new WebSocket(`${wsBase}/api/v1/video-calls/ws/${user.id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_call', call_id: Number(callId), role: 'client' }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'call_joined':
            // Server confirmed — if agent already in room they'll send us an offer shortly
            break;

          case 'offer': {
            // Agent sent offer → create answer
            const pc = createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', answer, call_id: Number(callId) }));
            break;
          }

          case 'answer':
            if (pcRef.current) {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.answer));
            }
            break;

          case 'ice_candidate':
            if (pcRef.current) {
              try { await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
            }
            break;

          case 'peer_left':
            setCallState('connecting');
            setRemoteStream(null);
            remoteStreamRef.current = null;
            break;

          case 'verification_complete':
            setResult({ outcome: msg.outcome, tx_hash: msg.tx_hash });
            setCallState('completed');
            cleanup(false);
            break;
        }
      };

      ws.onerror = () => toast({ title: 'Connection error', description: 'Signaling lost', variant: 'destructive' });
    };

    init();
    return () => cleanup(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  const cleanup = (closeWs = true) => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    if (closeWs) wsRef.current?.close();
  };

  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsVideoOn((v) => !v);
  };

  const toggleAudio = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsAudioOn((a) => !a);
  };

  // ── Completed screen ──────────────────────────────────────────────────────
  if (callState === 'completed' && result) {
    const approved = result.outcome === 'approved';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center shadow-lg">
          <CardContent className="pt-10 pb-8 space-y-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto ${approved ? 'bg-green-100' : 'bg-red-100'}`}>
              {approved
                ? <CheckCircle className="h-10 w-10 text-green-600" />
                : <XCircle className="h-10 w-10 text-red-600" />}
            </div>
            <div>
              <h2 className={`text-2xl font-bold ${approved ? 'text-green-700' : 'text-red-700'}`}>
                {approved ? 'Identity Verified!' : 'Verification Rejected'}
              </h2>
              <p className="text-gray-600 mt-2 text-sm">
                {approved
                  ? 'Your identity has been confirmed by a verified agent.'
                  : 'Your document could not be verified. Please contact support or try again.'}
              </p>
            </div>
            {approved && (
              <div className="bg-gray-50 border rounded-lg p-4 text-left space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Shield className="h-4 w-4 text-blue-600" />
                  Thronos Blockchain Proof
                </div>
                {result.tx_hash && result.tx_hash !== 'pending' ? (
                  <p className="text-xs text-gray-500 font-mono break-all">{result.tx_hash}</p>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Anchoring to Thronos blockchain via ACICS miners…
                  </div>
                )}
              </div>
            )}
            <Button className="w-full" onClick={() => navigate('/client')}>
              Go to My Portal
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Video call screen ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-900/80 border-b border-gray-800 flex-shrink-0">
        <div>
          <h1 className="text-base font-bold">Identity Verification Call</h1>
          <p className="text-xs text-gray-400">Your agent is verifying your identity</p>
        </div>
        <Badge className={callState === 'in_call' ? 'bg-green-600 text-xs' : 'bg-yellow-600 text-xs'}>
          {callState === 'in_call' ? 'Connected' : 'Connecting…'}
        </Badge>
      </div>

      {cameraError && (
        <div className="mx-4 mt-3 bg-red-900/50 border border-red-600 rounded-lg p-3 text-red-200 text-sm flex-shrink-0">
          {cameraError}
        </div>
      )}

      {/* PiP video area */}
      <div className="flex-1 flex flex-col p-3 gap-3 min-h-0">

        <div className="relative flex-1 bg-gray-900 rounded-2xl overflow-hidden min-h-0">

          {/* Main video */}
          <video
            ref={mainVideoRef}
            autoPlay
            playsInline
            muted={pipSwapped}
            className="w-full h-full object-cover"
          />

          {/* Waiting overlay (when remote/agent not connected yet) */}
          {!pipSwapped && callState === 'connecting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 gap-3 pointer-events-none">
              <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
              <p className="text-sm">Waiting for agent to connect…</p>
            </div>
          )}

          {/* Main label */}
          <div className="absolute top-3 left-3">
            <Badge variant="secondary" className="text-xs bg-black/50 text-white border-0 backdrop-blur-sm">
              {pipSwapped ? 'You' : 'Agent'}
            </Badge>
          </div>

          {/* PiP overlay */}
          <div className="absolute bottom-3 right-3 w-40 h-24 rounded-xl overflow-hidden shadow-2xl border border-white/20 bg-gray-800 group">
            <video
              ref={pipVideoRef}
              autoPlay
              playsInline
              muted={!pipSwapped}
              className="w-full h-full object-cover"
            />

            {(pipSwapped ? !remoteStream : !localStream) && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Video className="h-5 w-5 text-gray-500 opacity-40" />
              </div>
            )}

            <div className="absolute bottom-1 left-1.5">
              <Badge variant="secondary" className="text-[10px] bg-black/60 text-white border-0">
                {pipSwapped ? 'Agent' : 'You'}
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
          <Button size="lg" variant={isVideoOn ? 'secondary' : 'destructive'} onClick={toggleVideo} className="rounded-full h-12 w-12 p-0">
            {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </Button>
          <Button size="lg" variant={isAudioOn ? 'secondary' : 'destructive'} onClick={toggleAudio} className="rounded-full h-12 w-12 p-0">
            {isAudioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </Button>
          <Button size="lg" variant="destructive" onClick={() => { cleanup(); navigate('/client'); }} className="rounded-full h-12 w-12 p-0">
            <PhoneOff className="h-5 w-5" />
          </Button>
        </div>

        {/* Instructions */}
        <Card className="bg-gray-800 border-gray-700 flex-shrink-0">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm text-white">During the call</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-gray-400 space-y-1 px-4 pb-3">
            <p>1. Make sure your face is clearly visible</p>
            <p>2. Hold your document up to the camera when asked</p>
            <p>3. The agent will confirm your identity and give the result</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
