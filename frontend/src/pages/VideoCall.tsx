import { useEffect, useRef, useState } from 'react';
import { createClient } from '@metagptx/web-sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Video, VideoOff, Mic, MicOff, Phone, PhoneOff, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const client = createClient();

interface OnlineUser {
  id: string;
  email: string;
}

interface CallSession {
  session_id: string;
  caller_id: string;
  callee_id: string;
  status: string;
}

export default function VideoCall() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [incomingCall, setIncomingCall] = useState<any>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();

  // ICE servers configuration (using public STUN servers)
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  // Initialize user and WebSocket connection
  useEffect(() => {
    const initializeVideoCall = async () => {
      try {
        // Get current user
        const userResponse = await client.auth.me();
        setCurrentUser(userResponse.data);

        // Connect to WebSocket
        const wsUrl = `ws://localhost:8000/api/v1/video-call/ws/${userResponse.data.id}`;
        const websocket = new WebSocket(wsUrl);

        websocket.onopen = () => {
          console.log('WebSocket connected');
          setWs(websocket);
          loadOnlineUsers();
        };

        websocket.onmessage = async (event) => {
          const message = JSON.parse(event.data);
          await handleSignalingMessage(message);
        };

        websocket.onerror = (error) => {
          console.error('WebSocket error:', error);
          toast({
            title: 'Connection Error',
            description: 'Failed to connect to video call service',
            variant: 'destructive',
          });
        };

        websocket.onclose = () => {
          console.log('WebSocket disconnected');
          setWs(null);
        };

        return () => {
          websocket.close();
        };
      } catch (error: any) {
        const detail = error?.data?.detail || error?.response?.data?.detail || error.message;
        toast({
          title: 'Initialization Error',
          description: detail,
          variant: 'destructive',
        });
      }
    };

    initializeVideoCall();
  }, []);

  // Load online users
  const loadOnlineUsers = async () => {
    try {
      const response = await client.apiCall.invoke({
        url: '/api/v1/video-call/online-users',
        method: 'GET',
      });
      setOnlineUsers(response.data.online_users || []);
    } catch (error: any) {
      console.error('Failed to load online users:', error);
    }
  };

  // Handle signaling messages
  const handleSignalingMessage = async (message: any) => {
    switch (message.type) {
      case 'incoming_call':
        setIncomingCall(message);
        setCallState('ringing');
        toast({
          title: 'Incoming Call',
          description: `${message.caller_email} is calling you`,
        });
        break;

      case 'call_accepted':
        setCallState('connected');
        toast({
          title: 'Call Accepted',
          description: 'The call has been accepted',
        });
        break;

      case 'call_rejected':
        setCallState('idle');
        cleanupCall();
        toast({
          title: 'Call Rejected',
          description: 'The call was rejected',
          variant: 'destructive',
        });
        break;

      case 'call_ended':
        setCallState('idle');
        cleanupCall();
        toast({
          title: 'Call Ended',
          description: 'The call has ended',
        });
        break;

      case 'offer':
        await handleOffer(message);
        break;

      case 'answer':
        await handleAnswer(message);
        break;

      case 'ice_candidate':
        await handleIceCandidate(message);
        break;
    }
  };

  // Initialize local media stream
  const initializeLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error('Failed to get local stream:', error);
      toast({
        title: 'Camera/Microphone Error',
        description: 'Failed to access camera or microphone',
        variant: 'destructive',
      });
      throw error;
    }
  };

  // Create peer connection
  const createPeerConnection = (stream: MediaStream) => {
    const pc = new RTCPeerConnection(iceServers);

    // Add local stream tracks to peer connection
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Handle remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setRemoteStream(remoteStream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && ws && callSession) {
        ws.send(
          JSON.stringify({
            type: 'ice_candidate',
            session_id: callSession.session_id,
            candidate: event.candidate,
          })
        );
      }
    };

    setPeerConnection(pc);
    return pc;
  };

  // Initiate a call
  const initiateCall = async (calleeId: string) => {
    try {
      setCallState('calling');

      // Initialize local stream
      const stream = await initializeLocalStream();

      // Initiate call via API
      const response = await client.apiCall.invoke({
        url: '/api/v1/video-call/initiate',
        method: 'POST',
        data: { callee_id: calleeId },
      });

      const session = response.data;
      setCallSession(session);

      // Create peer connection
      const pc = createPeerConnection(stream);

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (ws) {
        ws.send(
          JSON.stringify({
            type: 'offer',
            session_id: session.session_id,
            offer: offer,
          })
        );
      }
    } catch (error: any) {
      const detail = error?.data?.detail || error?.response?.data?.detail || error.message;
      toast({
        title: 'Call Failed',
        description: detail,
        variant: 'destructive',
      });
      setCallState('idle');
    }
  };

  // Accept incoming call
  const acceptCall = async () => {
    try {
      if (!incomingCall) return;

      // Initialize local stream
      const stream = await initializeLocalStream();

      // Accept call via API
      await client.apiCall.invoke({
        url: '/api/v1/video-call/respond',
        method: 'POST',
        data: {
          session_id: incomingCall.session_id,
          action: 'accept',
        },
      });

      setCallSession({ session_id: incomingCall.session_id } as CallSession);
      setCallState('connected');
      setIncomingCall(null);

      // Create peer connection
      createPeerConnection(stream);
    } catch (error: any) {
      const detail = error?.data?.detail || error?.response?.data?.detail || error.message;
      toast({
        title: 'Failed to Accept Call',
        description: detail,
        variant: 'destructive',
      });
    }
  };

  // Reject incoming call
  const rejectCall = async () => {
    try {
      if (!incomingCall) return;

      await client.apiCall.invoke({
        url: '/api/v1/video-call/respond',
        method: 'POST',
        data: {
          session_id: incomingCall.session_id,
          action: 'reject',
        },
      });

      setIncomingCall(null);
      setCallState('idle');
    } catch (error: any) {
      console.error('Failed to reject call:', error);
    }
  };

  // Handle WebRTC offer
  const handleOffer = async (message: any) => {
    if (!peerConnection || !localStream) return;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    if (ws && callSession) {
      ws.send(
        JSON.stringify({
          type: 'answer',
          session_id: callSession.session_id,
          answer: answer,
        })
      );
    }
  };

  // Handle WebRTC answer
  const handleAnswer = async (message: any) => {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
  };

  // Handle ICE candidate
  const handleIceCandidate = async (message: any) => {
    if (!peerConnection) return;
    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
  };

  // End call
  const endCall = async () => {
    try {
      if (callSession) {
        await client.apiCall.invoke({
          url: `/api/v1/video-call/end/${callSession.session_id}`,
          method: 'POST',
        });
      }
      cleanupCall();
      setCallState('idle');
    } catch (error: any) {
      console.error('Failed to end call:', error);
      cleanupCall();
      setCallState('idle');
    }
  };

  // Cleanup call resources
  const cleanupCall = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    if (peerConnection) {
      peerConnection.close();
      setPeerConnection(null);
    }
    setRemoteStream(null);
    setCallSession(null);
    setIncomingCall(null);
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Video Call</h1>
            <p className="text-gray-600 mt-2">Connect with agents via live video</p>
          </div>
          <Badge variant={ws ? 'default' : 'destructive'}>
            {ws ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>

        {/* Incoming Call Alert */}
        {incomingCall && (
          <Alert>
            <Phone className="w-4 h-4" />
            <AlertDescription className="flex justify-between items-center">
              <span>Incoming call from {incomingCall.caller_email}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={acceptCall}>
                  Accept
                </Button>
                <Button size="sm" variant="destructive" onClick={rejectCall}>
                  Reject
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video Area */}
          <div className="lg:col-span-2 space-y-4">
            {/* Remote Video */}
            <Card>
              <CardContent className="p-0">
                <div className="relative bg-gray-900 aspect-video rounded-lg overflow-hidden">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  {!remoteStream && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                      <div className="text-center">
                        <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p className="text-lg">Waiting for connection...</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Local Video */}
            <Card>
              <CardContent className="p-0">
                <div className="relative bg-gray-800 aspect-video rounded-lg overflow-hidden max-w-sm">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {!localStream && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                      <Video className="w-12 h-12 opacity-50" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Call Controls */}
            {callState !== 'idle' && (
              <div className="flex justify-center gap-4">
                <Button
                  size="lg"
                  variant={isVideoEnabled ? 'default' : 'destructive'}
                  onClick={toggleVideo}
                >
                  {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </Button>
                <Button
                  size="lg"
                  variant={isAudioEnabled ? 'default' : 'destructive'}
                  onClick={toggleAudio}
                >
                  {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </Button>
                <Button size="lg" variant="destructive" onClick={endCall}>
                  <PhoneOff className="w-5 h-5" />
                </Button>
              </div>
            )}
          </div>

          {/* Online Users */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Online Users
                </CardTitle>
                <CardDescription>Available for video calls</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {onlineUsers.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">No users online</p>
                  ) : (
                    onlineUsers.map((user) => (
                      <div
                        key={user.id}
                        className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50"
                      >
                        <div>
                          <p className="font-medium">{user.email || `User ${user.id}`}</p>
                          <Badge variant="outline" className="mt-1">
                            Online
                          </Badge>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => initiateCall(user.id)}
                          disabled={callState !== 'idle'}
                        >
                          <Phone className="w-4 h-4 mr-2" />
                          Call
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <Button className="w-full mt-4" variant="outline" onClick={loadOnlineUsers}>
                  Refresh
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}