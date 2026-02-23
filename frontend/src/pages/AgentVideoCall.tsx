import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '@/lib/api';
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
  FileText,
  User,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

export default function AgentVideoCall() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [callDetails, setCallDetails] = useState<CallDetails | null>(null);
  const [verification, setVerification] = useState<VerificationDetails | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Camera / microphone setup ─────────────────────────────────────────────
  const startLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraError(null);
      return stream;
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'
          ? 'Camera/microphone access denied. Please allow access in your browser settings.'
          : 'Could not access camera or microphone.';
      setCameraError(msg);
      toast({ title: 'Camera Error', description: msg, variant: 'destructive' });
      return null;
    }
  }, [toast]);

  // ── WebSocket signaling ───────────────────────────────────────────────────
  const connectSignaling = useCallback(
    (userId: string, stream: MediaStream) => {
      const base = getAPIBaseURL();
      const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
      const ws = new WebSocket(`${wsBase}/api/v1/video-calls/ws/${userId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_call', call_id: Number(callId) }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        const pc = pcRef.current;

        if (msg.type === 'offer' && pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'answer', answer, call_id: Number(callId) }));
        } else if (msg.type === 'answer' && pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        } else if (msg.type === 'ice_candidate' && pc) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
      };

      // Set up PeerConnection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.ontrack = (event) => {
        const [remote] = event.streams;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(
            JSON.stringify({ type: 'ice_candidate', candidate: event.candidate, call_id: Number(callId) }),
          );
        }
      };

      // Create offer (agent initiates)
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (pc.localDescription) {
            ws.send(JSON.stringify({ type: 'offer', offer: pc.localDescription, call_id: Number(callId) }));
          }
        })
        .catch((e) => console.error('Offer error:', e));
    },
    [callId],
  );

  // ── Load call + verification data ────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      if (!callId) return;
      try {
        // Get call details via pending list (or direct lookup)
        const res = await apiClient.get<CallDetails[]>('/api/v1/video-calls/pending');
        // Include in-progress calls too
        const allRes = await apiClient.get<CallDetails[]>('/api/v1/video-calls/active').catch(() => ({ data: [] }));
        const allCalls = [...res.data, ...allRes.data];
        const call = allCalls.find((c) => c.id === Number(callId));
        if (call) {
          setCallDetails(call);
          // Load verification document
          const verRes = await apiClient.get<VerificationDetails>(
            `/api/v1/verifications/${call.verification_id}`,
          ).catch(() => null);
          if (verRes) setVerification(verRes.data);
        }

        // Start camera
        const stream = await startLocalStream();
        if (!stream) return;

        // Get current user for WS
        const userRes = await apiClient.get<{ id: string }>('/api/v1/auth/me');
        connectSignaling(userRes.data.id, stream);
      } catch (err) {
        console.error('Init error:', err);
      }
    };
    init();

    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleVideo = () => {
    localStream?.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsVideoOn((v) => !v);
  };

  const toggleAudio = () => {
    localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsAudioOn((a) => !a);
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
          ? 'Client has been approved. Blockchain anchoring in progress.'
          : 'Verification rejected. Client has been notified.',
      });
      // Cleanup
      localStream?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      wsRef.current?.close();
      navigate('/agent');
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.response?.data?.detail || err.message,
        variant: 'destructive',
      });
      setCompleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Video Verification Call</h1>
            {callDetails && (
              <p className="text-sm text-gray-400 mt-1">
                Call #{callDetails.id} · Customer: {callDetails.customer_id}
              </p>
            )}
          </div>
          <Badge className={localStream ? 'bg-green-600' : 'bg-red-600'}>
            {localStream ? 'Camera Active' : 'No Camera'}
          </Badge>
        </div>

        {/* Camera error */}
        {cameraError && (
          <div className="bg-red-900/50 border border-red-600 rounded-lg p-4 text-red-200 text-sm">
            {cameraError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Video area ── */}
          <div className="lg:col-span-2 space-y-3">

            {/* Remote video (client) */}
            <div className="relative bg-gray-800 aspect-video rounded-xl overflow-hidden">
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* shown only when no remote stream */}
                <div id="remote-placeholder" className="text-center text-gray-500">
                  <User className="h-16 w-16 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Waiting for client to connect…</p>
                </div>
              </div>
              <div className="absolute bottom-3 left-3">
                <Badge variant="secondary" className="text-xs">Client</Badge>
              </div>
            </div>

            {/* Local video (agent) */}
            <div className="relative bg-gray-700 rounded-xl overflow-hidden" style={{ maxHeight: '160px' }}>
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {!localStream && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  <Video className="h-8 w-8 opacity-40" />
                </div>
              )}
              <div className="absolute bottom-2 left-2">
                <Badge variant="secondary" className="text-xs">You (Agent)</Badge>
              </div>
            </div>

            {/* Call controls */}
            <div className="flex justify-center gap-3">
              <Button
                size="lg"
                variant={isVideoOn ? 'secondary' : 'destructive'}
                onClick={toggleVideo}
                title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
              >
                {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
              <Button
                size="lg"
                variant={isAudioOn ? 'secondary' : 'destructive'}
                onClick={toggleAudio}
                title={isAudioOn ? 'Mute mic' : 'Unmute mic'}
              >
                {isAudioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </Button>
              <Button
                size="lg"
                variant="destructive"
                onClick={() => {
                  localStream?.getTracks().forEach((t) => t.stop());
                  pcRef.current?.close();
                  wsRef.current?.close();
                  navigate('/agent');
                }}
                title="Leave call without decision"
              >
                <PhoneOff className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* ── Right panel: document + decision ── */}
          <div className="space-y-4">

            {/* Document preview */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Uploaded Document
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {verification ? (
                  <>
                    <div className="text-xs text-gray-400 space-y-1">
                      <p><span className="font-medium text-gray-300">Type:</span> {verification.document_type.replace('_', ' ').toUpperCase()}</p>
                      {verification.full_name && (
                        <p><span className="font-medium text-gray-300">Name:</span> {verification.full_name}</p>
                      )}
                      {verification.document_number && (
                        <p><span className="font-medium text-gray-300">Number:</span> {verification.document_number}</p>
                      )}
                    </div>
                    {verification.document_image_url ? (
                      <img
                        src={verification.document_image_url}
                        alt="Front of document"
                        className="w-full rounded-lg border border-gray-600 mt-2"
                      />
                    ) : (
                      <p className="text-xs text-gray-500 italic">No image available</p>
                    )}
                    {(() => {
                      try {
                        const data = verification.extracted_data ? JSON.parse(verification.extracted_data) : null;
                        if (data?.back_image_url) {
                          return (
                            <>
                              <p className="text-xs text-gray-400 mt-2 font-medium">Back side:</p>
                              <img
                                src={data.back_image_url}
                                alt="Back of document"
                                className="w-full rounded-lg border border-gray-600 mt-1"
                              />
                            </>
                          );
                        }
                      } catch { /* ignore */ }
                      return null;
                    })()}
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading document…
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Approve / Reject */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white">Verification Decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-gray-400">
                  Confirm the client's identity matches the document before deciding.
                </p>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  disabled={completing}
                  onClick={() => completeCall('approved')}
                >
                  {completing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2" />
                  )}
                  Approve Identity
                </Button>
                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  disabled={completing}
                  variant="destructive"
                  onClick={() => completeCall('rejected')}
                >
                  {completing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4 mr-2" />
                  )}
                  Reject
                </Button>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
