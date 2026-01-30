# Real-Time Chat System Documentation

## Overview

A production-ready real-time chat system built with FastAPI, WebSockets, and Atoms Backend. Supports group chats, direct messaging, typing indicators, online presence, and message history.

## Features

### ✅ Core Features
- **Real-time messaging** with WebSocket connections
- **Group chats** for team collaboration
- **Direct messages** (1-on-1 conversations)
- **Typing indicators** showing who's typing
- **Online presence** tracking (online, offline, away, busy)
- **Message history** with pagination
- **Unread message counts** per conversation
- **Message editing** and deletion
- **Reply to messages** threading
- **Read receipts** tracking

### 🗄️ Database Models

#### 1. Conversations
Stores chat rooms and direct message conversations.

```python
- id: Primary key
- user_id: Creator user ID
- conversation_type: "direct" or "group"
- name: Conversation name (optional for direct)
- description: Conversation description
- avatar_url: Group avatar URL
- is_active: Boolean flag
- created_at, updated_at, last_message_at: Timestamps
```

#### 2. ConversationParticipants
Tracks users in each conversation.

```python
- id: Primary key
- user_id: Participant user ID
- conversation_id: Foreign key to Conversations
- username: Display name
- user_avatar: Avatar URL
- role: "admin" or "member"
- is_muted: Boolean flag
- joined_at: Join timestamp
- last_read_at: Last read timestamp (for unread counts)
```

#### 3. Messages
Stores all chat messages.

```python
- id: Primary key
- user_id: Sender user ID
- conversation_id: Foreign key to Conversations
- username: Sender display name
- user_avatar: Sender avatar URL
- content: Message text
- message_type: "text", "image", "file", "system"
- reply_to_id: Foreign key to Messages (for threading)
- is_edited: Boolean flag
- is_deleted: Boolean flag (soft delete)
- created_at, edited_at: Timestamps
```

#### 4. TypingIndicators
Tracks real-time typing status.

```python
- id: Primary key
- user_id: Typing user ID
- conversation_id: Foreign key to Conversations
- username: Display name
- is_typing: Boolean flag
- started_at: Start timestamp
- expires_at: Expiration timestamp (auto-cleanup after 5s)
```

#### 5. UserPresence
Tracks user online status.

```python
- id: Primary key
- user_id: User ID (unique)
- username: Display name
- user_avatar: Avatar URL
- status: "online", "offline", "away", "busy"
- status_message: Custom status message
- last_active: Last activity timestamp
- updated_at: Update timestamp
```

## API Endpoints

### Conversations

#### Create Conversation
```http
POST /api/v1/chat/conversations
Content-Type: application/json
Authorization: Bearer <token>

{
  "conversation_type": "group",
  "name": "Development Team",
  "description": "Team collaboration chat",
  "participant_ids": ["user-id-1", "user-id-2"]
}
```

#### Get User Conversations
```http
GET /api/v1/chat/conversations
Authorization: Bearer <token>

Response: List of conversations with unread counts
```

#### Get Conversation Participants
```http
GET /api/v1/chat/conversations/{conversation_id}/participants
Authorization: Bearer <token>
```

### Messages

#### Send Message
```http
POST /api/v1/chat/messages
Content-Type: application/json
Authorization: Bearer <token>

{
  "conversation_id": 1,
  "content": "Hello team!",
  "message_type": "text",
  "reply_to_id": null
}
```

#### Get Messages (with pagination)
```http
GET /api/v1/chat/conversations/{conversation_id}/messages?limit=50&before_id=100
Authorization: Bearer <token>
```

#### Edit Message
```http
PUT /api/v1/chat/messages/{message_id}
Content-Type: application/json
Authorization: Bearer <token>

{
  "content": "Updated message content"
}
```

#### Delete Message
```http
DELETE /api/v1/chat/messages/{message_id}
Authorization: Bearer <token>
```

#### Mark as Read
```http
POST /api/v1/chat/conversations/{conversation_id}/read
Authorization: Bearer <token>
```

### Direct Messages

#### Send Direct Message
```http
POST /api/v1/chat/direct
Content-Type: application/json
Authorization: Bearer <token>

{
  "recipient_user_id": "user-id-123",
  "content": "Hi there!"
}
```

### Typing Indicators

#### Update Typing Status
```http
POST /api/v1/chat/typing
Content-Type: application/json
Authorization: Bearer <token>

{
  "conversation_id": 1,
  "is_typing": true
}
```

### User Presence

#### Update Presence
```http
POST /api/v1/chat/presence
Content-Type: application/json
Authorization: Bearer <token>

{
  "status": "online",
  "status_message": "Working on the new feature"
}
```

#### Get Online Users
```http
GET /api/v1/chat/users/online
Authorization: Bearer <token>
```

## WebSocket Connection

### Connect to Conversation
```javascript
const ws = new WebSocket(
  `ws://your-server/api/v1/chat/ws/{conversation_id}?token={user_token}`
);

ws.onopen = () => {
  console.log('Connected to chat');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'connected':
      console.log('Connection confirmed');
      break;
    case 'message':
      console.log('New message:', data.message);
      break;
    case 'typing':
      console.log('User typing:', data.typing);
      break;
    case 'presence':
      console.log('User status:', data.presence);
      break;
  }
};

// Send ping to keep connection alive
setInterval(() => {
  ws.send(JSON.stringify({ type: 'ping' }));
}, 30000);
```

### WebSocket Message Types

#### Received Messages

**Connection Confirmation**
```json
{
  "type": "connected",
  "conversation_id": 1,
  "timestamp": "2024-01-27T10:30:00Z"
}
```

**New Message**
```json
{
  "type": "message",
  "conversation_id": 1,
  "message": {
    "id": 123,
    "user_id": "user-123",
    "username": "John Doe",
    "content": "Hello!",
    "created_at": "2024-01-27T10:30:00Z"
  },
  "timestamp": "2024-01-27T10:30:00Z"
}
```

**Typing Indicator**
```json
{
  "type": "typing",
  "conversation_id": 1,
  "typing": {
    "user_id": "user-456",
    "username": "Jane Smith",
    "is_typing": true,
    "started_at": "2024-01-27T10:30:00Z"
  },
  "timestamp": "2024-01-27T10:30:00Z"
}
```

**Presence Update**
```json
{
  "type": "presence",
  "presence": {
    "user_id": "user-789",
    "username": "Bob Johnson",
    "status": "online",
    "last_active": "2024-01-27T10:30:00Z"
  },
  "timestamp": "2024-01-27T10:30:00Z"
}
```

## Frontend Integration Example

### React Hook for Chat

```typescript
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@metagptx/web-sdk';

const client = createClient();

export function useChat(conversationId: number) {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const wsRef = useRef<WebSocket>();

  useEffect(() => {
    // Load message history
    loadMessages();
    
    // Connect WebSocket
    connectWebSocket();
    
    return () => {
      wsRef.current?.close();
    };
  }, [conversationId]);

  const loadMessages = async () => {
    const response = await client.apiCall.invoke({
      url: `/api/v1/chat/conversations/${conversationId}/messages`,
      method: 'GET'
    });
    setMessages(response.data);
  };

  const connectWebSocket = () => {
    const token = localStorage.getItem('auth_token');
    const ws = new WebSocket(
      `ws://localhost:8000/api/v1/chat/ws/${conversationId}?token=${token}`
    );

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'message') {
        setMessages(prev => [...prev, data.message]);
      } else if (data.type === 'typing') {
        handleTypingIndicator(data.typing);
      }
    };

    wsRef.current = ws;
  };

  const sendMessage = async (content: string) => {
    await client.apiCall.invoke({
      url: '/api/v1/chat/messages',
      method: 'POST',
      data: {
        conversation_id: conversationId,
        content
      }
    });
  };

  const updateTyping = async (isTyping: boolean) => {
    await client.apiCall.invoke({
      url: '/api/v1/chat/typing',
      method: 'POST',
      data: {
        conversation_id: conversationId,
        is_typing: isTyping
      }
    });
  };

  return {
    messages,
    isConnected,
    typingUsers,
    sendMessage,
    updateTyping
  };
}
```

## Performance Optimizations

### Database Indexes
- Composite index on `(conversation_id, created_at)` for fast message queries
- Index on `user_id` for quick user lookups
- Index on `(conversation_id, expires_at)` for typing indicator cleanup

### WebSocket Management
- Connection pooling per conversation
- Automatic cleanup of disconnected clients
- Heartbeat ping/pong to detect dead connections

### Message Pagination
- Load messages in batches of 50
- Support for "load more" with `before_id` parameter
- Reverse chronological order for efficient queries

## Security Considerations

1. **Authentication**: All endpoints require JWT token
2. **Authorization**: Users can only access conversations they're part of
3. **Input Validation**: Pydantic schemas validate all inputs
4. **Rate Limiting**: Implement rate limiting for message sending
5. **XSS Prevention**: Sanitize message content on frontend
6. **WebSocket Security**: Validate tokens on WebSocket connection

## Deployment

### Environment Variables
```env
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/chatdb
SECRET_KEY=your-secret-key
```

### Running the Server
```bash
cd /workspace/app/backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Production Deployment
- Use Gunicorn with Uvicorn workers
- Set up Nginx as reverse proxy
- Enable WebSocket support in Nginx
- Configure SSL/TLS certificates
- Set up database connection pooling

## Testing

### Test WebSocket Connection
```bash
# Using wscat
wscat -c "ws://localhost:8000/api/v1/chat/ws/1?token=your-token"
```

### Test API Endpoints
```bash
# Create conversation
curl -X POST http://localhost:8000/api/v1/chat/conversations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conversation_type":"group","name":"Test","participant_ids":[]}'

# Send message
curl -X POST http://localhost:8000/api/v1/chat/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":1,"content":"Hello!"}'
```

## Troubleshooting

### WebSocket Connection Issues
- Verify token is valid
- Check firewall allows WebSocket connections
- Ensure Nginx WebSocket proxy is configured
- Check server logs for connection errors

### Message Not Appearing
- Verify user is participant in conversation
- Check WebSocket connection is active
- Verify message was saved to database
- Check for JavaScript console errors

### High Database Load
- Enable query logging to identify slow queries
- Add missing indexes
- Implement message archiving for old conversations
- Use read replicas for message history queries

## Future Enhancements

- [ ] File upload support (images, documents)
- [ ] Voice/video call integration
- [ ] Message reactions (emoji)
- [ ] Message search functionality
- [ ] Push notifications
- [ ] Message encryption (E2E)
- [ ] Message forwarding
- [ ] User blocking
- [ ] Conversation archiving
- [ ] Admin moderation tools

## Support

For issues or questions:
- Check server logs: `tail -f logs/app_*.log`
- Review database queries with `EXPLAIN ANALYZE`
- Monitor WebSocket connections
- Contact development team

---

**Version**: 1.0.0  
**Last Updated**: 2024-01-27  
**License**: Proprietary