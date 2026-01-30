# Role-Based Access Control (RBAC) System

## Overview

This document describes the RBAC system integrated into the Identity Verification Platform. The system provides fine-grained access control for different user roles with seamless integration between backend and frontend.

## Architecture

### Backend Components

1. **Database Models** (`backend/models/rbac.py`)
   - `Roles`: System roles (admin, it_staff, kyc_agent, management)
   - `Permissions`: Granular permissions (resource + action)
   - `RolePermissions`: Many-to-many relationship
   - `UserRoles`: User role assignments

2. **API Endpoints** (`backend/routers/rbac.py`)
   - `GET /api/v1/rbac/roles` - List all roles
   - `POST /api/v1/rbac/users/assign-role` - Assign role to user
   - `GET /api/v1/rbac/users/{user_id}/permissions` - Get user permissions
   - `GET /api/v1/rbac/me/permissions` - Get current user permissions
   - `GET /api/v1/rbac/check-permission/{resource}/{action}` - Check permission

3. **Service Layer** (`backend/services/rbac.py`)
   - Role initialization with default roles
   - Permission checking logic
   - User role management

### Frontend Components

1. **RBAC Manager** (`frontend/src/lib/rbac.ts`)
   - Client-side permission checking
   - Role-based helper methods
   - Caching for performance

2. **Protected Pages**
   - Dashboard with role-based menu items
   - Chat system with send/manage permissions
   - Verifications with CRUD permissions

## Default Roles

### 1. Admin
**Full system access**
- All permissions granted
- User management
- System settings
- Reports and analytics

### 2. IT Staff
**Technical administration**
- Verifications: read, create, update, delete
- Chat: read, send, manage
- Users: read, manage
- Settings: read, manage
- Reports: read

### 3. KYC Agent / Call Center
**Verification operations**
- Verifications: read, create, update
- Chat: read, send
- Reports: read (limited)

### 4. Management
**Oversight and reporting**
- Verifications: read
- Chat: read
- Users: read
- Reports: read
- Settings: read

## Permission Structure

Permissions follow the format: `{resource}.{action}`

### Resources
- `verifications` - Identity verification operations
- `chat` - Team communication
- `users` - User management
- `settings` - System configuration
- `reports` - Analytics and reporting

### Actions
- `read` - View/list resources
- `create` - Create new resources
- `update` - Modify existing resources
- `delete` - Remove resources
- `manage` - Full administrative control
- `send` - Send messages (chat-specific)

## Usage Examples

### Backend - Check Permission

```python
from services.rbac import RBACService

# Check if user has permission
has_permission = await RBACService.check_permission(
    db=db,
    user_id="user123",
    resource="verifications",
    action="create"
)

if not has_permission:
    raise HTTPException(status_code=403, detail="Permission denied")
```

### Backend - Assign Role

```python
# Assign role to user
await RBACService.assign_role_to_user(
    db=db,
    user_id="user123",
    role_id=2,  # IT Staff
    assigned_by="admin_user_id"
)
```

### Frontend - Check Permission

```typescript
import { rbac } from '@/lib/rbac';

// Initialize RBAC (do this once on app load)
await rbac.initialize();

// Check specific permission
if (rbac.canAccessVerifications()) {
  // Show verifications module
}

// Check role
if (rbac.isKYCAgent()) {
  // Show KYC-specific features
}

// Check granular permission
if (rbac.hasPermission('chat', 'manage')) {
  // Show chat management options
}
```

### Frontend - Protect Routes

```typescript
// In component
useEffect(() => {
  const checkAccess = async () => {
    await rbac.initialize();
    if (!rbac.canAccessChat()) {
      toast({
        title: 'Access Denied',
        description: 'You do not have permission to access chat',
        variant: 'destructive'
      });
      navigate('/dashboard');
    }
  };
  checkAccess();
}, []);
```

## Database Initialization

The system automatically initializes default roles and permissions on first startup:

```python
# In main.py or startup event
from services.database import initialize_database

await initialize_database()
```

This creates:
- 4 default roles (admin, it_staff, kyc_agent, management)
- All necessary permissions
- Role-permission mappings

## Adding New Permissions

1. **Define Permission** (in `services/rbac.py`)
```python
permissions = [
    {"name": "new_feature.read", "resource": "new_feature", "action": "read"},
    {"name": "new_feature.create", "resource": "new_feature", "action": "create"},
]
```

2. **Assign to Roles**
```python
role_permissions = {
    "admin": ["new_feature.read", "new_feature.create"],
    "it_staff": ["new_feature.read"],
}
```

3. **Add Frontend Helper** (in `frontend/src/lib/rbac.ts`)
```typescript
canAccessNewFeature(): boolean {
  return this.hasPermission('new_feature', 'read');
}
```

## Security Considerations

1. **Backend Enforcement**
   - Always check permissions on the backend
   - Frontend checks are for UX only
   - Never trust client-side permission checks

2. **Token-Based Auth**
   - Permissions loaded from JWT token
   - Token refresh updates permissions
   - Expired tokens revoke all access

3. **Least Privilege**
   - Users assigned minimum required permissions
   - Temporary elevated access with expiration
   - Regular permission audits

4. **Audit Trail**
   - All role assignments logged
   - Permission checks can be logged
   - Track who assigned roles

## Testing

### Backend Tests
```python
# Test permission checking
async def test_check_permission():
    has_perm = await RBACService.check_permission(
        db, "user_id", "verifications", "read"
    )
    assert has_perm == True
```

### Frontend Tests
```typescript
// Test RBAC manager
describe('RBAC Manager', () => {
  it('should check permissions correctly', async () => {
    await rbac.initialize();
    expect(rbac.canAccessVerifications()).toBe(true);
  });
});
```

## Troubleshooting

### User Can't Access Module
1. Check user role assignment in database
2. Verify role has required permissions
3. Check frontend RBAC initialization
4. Clear browser cache/localStorage

### Permission Check Fails
1. Verify permission exists in database
2. Check role-permission mapping
3. Ensure user has active role assignment
4. Check token expiration

### Frontend Shows Wrong UI
1. Call `rbac.initialize()` on app load
2. Check network requests for permission data
3. Verify token is valid
4. Check browser console for errors

## Migration Guide

### From No RBAC to RBAC

1. **Database Migration**
```bash
# Run migrations
alembic upgrade head
```

2. **Assign Initial Roles**
```python
# Assign admin role to existing users
for user in existing_users:
    await RBACService.assign_role_to_user(
        db, user.id, admin_role_id, "system"
    )
```

3. **Update Frontend**
```typescript
// Wrap protected routes
<Route path="/chat" element={
  <ProtectedRoute permission="chat.read">
    <Chat />
  </ProtectedRoute>
} />
```

## API Reference

### GET /api/v1/rbac/roles
List all available roles.

**Response:**
```json
[
  {
    "id": 1,
    "name": "admin",
    "display_name": "Administrator",
    "description": "Full system access",
    "is_active": true
  }
]
```

### POST /api/v1/rbac/users/assign-role
Assign a role to a user.

**Request:**
```json
{
  "user_id": "user123",
  "role_id": 2
}
```

### GET /api/v1/rbac/me/permissions
Get current user's permissions.

**Response:**
```json
{
  "user_id": "user123",
  "roles": [...],
  "permissions": [
    {
      "name": "verifications.read",
      "resource": "verifications",
      "action": "read"
    }
  ]
}
```

## Best Practices

1. **Always initialize RBAC on app load**
2. **Check permissions before API calls**
3. **Hide UI elements user can't access**
4. **Show clear error messages for denied access**
5. **Log permission checks for audit**
6. **Regular permission reviews**
7. **Use role-based helpers for readability**
8. **Test permission boundaries**

## Support

For issues or questions:
- Check logs: `backend/logs/app_*.log`
- Review database: `user_roles`, `role_permissions` tables
- Contact IT support team