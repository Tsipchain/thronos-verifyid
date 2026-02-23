import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { authApi } from '@/lib/auth';
import { getAPIBaseURL } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  CheckCircle,
  XCircle,
  Loader2,
  Shield,
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

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const init = async () => {
      const user = await authApi.getCurrentUser();
      if (!user) { navigate('/login'); return; }

      // Start camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err: any) {
        const msg = err.name === 'NotAllowedError'
          ? 'Camera/microphone access denied. Please allow access in your browser settings and refresh.'
          : 'Could not access camera or microphone.';
        setCameraError(msg);
        toast({ title: 'Camera Error', description: msg, variant: 'destructive' });
      }

      // Connect WebSocket for signaling
      const base = getAPIBaseURL();
      const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
      const ws = new WebSocket(`${wsBase}/api/v1/video-calls/ws/${user.id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_call', call_id: Number(callId) }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'offer') {
          // Agent sent an offer — create answer
          const pc = createPeerConnection();
          await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'answer', answer, call_id: Number(callId) }));
          setCallState('in_call');

        } else if (msg.type === 'answer') {
          if (pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.answer));
          }
        } else if (msg.type === 'ice_candidate') {
          if (pcRef.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
          }
        } else if (msg.type === 'verification_complete') {
          setResult({ outcome: msg.outcome, tx_hash: msg.tx_hash });
          setCallState('completed');
          cleanup(false);
        }
      };

      ws.onerror = () => toast({ title: 'Connection error', description: 'Lost signaling connection', variant: 'destructive' });
    };

    init();

    return () => cleanup(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    // Add local tracks
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));

    // Show remote stream
    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
    };

    // Forward ICE candidates to server
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice_candidate',
          candidate: event.candidate,
          call_id: Number(callId),
        }));
      }
    };

    return pc;
  };

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

            {/* Blockchain proof */}
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
                    Anchoring to blockchain via ACICS miners…
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
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-4xl mx-auto space-y-4">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Identity Verification Call</h1>
            <p className="text-sm text-gray-400">Your agent is verifying your identity</p>
          </div>
          <Badge className={callState === 'in_call' ? 'bg-green-600' : 'bg-yellow-600'}>
            {callState === 'in_call' ? 'Connected' : 'Connecting…'}
          </Badge>
        </div>

        {cameraError && (
          <div className="bg-red-900/50 border border-red-600 rounded-lg p-4 text-red-200 text-sm">
            {cameraError}
          </div>
        )}

        {/* Remote video — agent */}
        <div className="relative bg-gray-800 aspect-video rounded-xl overflow-hidden">
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          {callState === 'connecting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
              <p className="text-sm">Waiting for agent to connect…</p>
            </div>
          )}
          <div className="absolute bottom-3 left-3">
            <Badge variant="secondary" className="text-xs">Agent</Badge>
          </div>
        </div>

        {/* Local video — client (small) */}
        <div className="relative bg-gray-700 rounded-xl overflow-hidden" style={{ maxHeight: '130px' }}>
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {!localStreamRef.current && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              <Video className="h-8 w-8 opacity-40" />
            </div>
          )}
          <div className="absolute bottom-2 left-2">
            <Badge variant="secondary" className="text-xs">You</Badge>
          </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-3">
          <Button size="lg" variant={isVideoOn ? 'secondary' : 'destructive'} onClick={toggleVideo}>
            {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </Button>
          <Button size="lg" variant={isAudioOn ? 'secondary' : 'destructive'} onClick={toggleAudio}>
            {isAudioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </Button>
          <Button size="lg" variant="destructive" onClick={() => { cleanup(); navigate('/client'); }}>
            <PhoneOff className="h-5 w-5" />
          </Button>
        </div>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white">What to do</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-gray-400 space-y-1">
            <p>1. Make sure your face is clearly visible</p>
            <p>2. Hold your document up to the camera when asked</p>
            <p>3. The agent will confirm your identity and approve or reject</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
