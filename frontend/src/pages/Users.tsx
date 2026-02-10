import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { rbac } from '@/lib/rbac';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Users } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  is_active: boolean;
}

const ROLE_OPTIONS = ['admin', 'manager', 'agent', 'client'];

export default function UsersPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formState, setFormState] = useState({
    email: '',
    name: '',
    password: '',
    role: 'client'
  });

  const fetchUsers = async () => {
    const response = await apiClient.get<AdminUser[]>('/api/v1/admin/users');
    setUsers(response.data);
  };

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        await rbac.initialize();
        if (!rbac.canAccessUsers()) {
          toast({
            title: 'Access Denied',
            description: 'You do not have permission to access users',
            variant: 'destructive'
          });
          navigate('/admin');
          return;
        }

        await fetchUsers();
      } catch (err) {
        console.error('Failed to load users', err);
        setError('Failed to load users.');
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, [navigate, toast]);

  const handleCreateUser = async () => {
    if (!formState.email || !formState.password) {
      toast({
        title: 'Missing fields',
        description: 'Email and password are required.',
        variant: 'destructive'
      });
      return;
    }

    try {
      setCreating(true);
      await apiClient.post('/api/v1/admin/users', {
        email: formState.email,
        password: formState.password,
        name: formState.name || undefined,
        role: formState.role
      });
      setFormState({ email: '', name: '', password: '', role: 'client' });
      await fetchUsers();
    } catch (err) {
      console.error('Failed to create user', err);
      toast({
        title: 'Create failed',
        description: 'Unable to create user. Check the console for details.',
        variant: 'destructive'
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Delete this user?')) {
      return;
    }

    try {
      await apiClient.delete(`/api/v1/admin/users/${userId}`);
      setUsers((prev) => prev.filter((user) => user.id !== userId));
    } catch (err) {
      console.error('Failed to delete user', err);
      toast({
        title: 'Delete failed',
        description: 'Unable to delete user.',
        variant: 'destructive'
      });
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await apiClient.patch(`/api/v1/admin/users/${userId}/role`, { role });
      setUsers((prev) => prev.map((user) => (user.id === userId ? { ...user, role } : user)));
    } catch (err) {
      console.error('Failed to update role', err);
      toast({
        title: 'Update failed',
        description: 'Unable to update user role.',
        variant: 'destructive'
      });
    }
  };

  const handleResetPassword = async (userId: string) => {
    const newPassword = window.prompt('Enter new password (min 8 characters):');
    if (!newPassword) {
      return;
    }

    try {
      await apiClient.post(`/api/v1/admin/users/${userId}/password`, { password: newPassword });
      toast({
        title: 'Password updated',
        description: 'The password was updated successfully.'
      });
    } catch (err) {
      console.error('Failed to reset password', err);
      toast({
        title: 'Reset failed',
        description: 'Unable to update password.',
        variant: 'destructive'
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Users className="h-6 w-6 text-purple-600" />
            <h1 className="text-xl font-bold">User Management</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Add User</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                value={formState.email}
                onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                value={formState.name}
                onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Optional name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-password">Password</Label>
              <Input
                id="user-password"
                type="password"
                value={formState.password}
                onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formState.role}
                onValueChange={(value) => setFormState((prev) => ({ ...prev, role: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Button onClick={handleCreateUser} disabled={creating}>
                {creating ? 'Creating...' : 'Create User'}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!error && users.length === 0 && (
              <p className="text-sm text-gray-600">No users found.</p>
            )}
            {!error && users.length > 0 && (
              <div className="space-y-3">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">{user.email}</p>
                      <Select
                        value={user.role}
                        onValueChange={(value) => handleRoleChange(user.id, value)}
                      >
                        <SelectTrigger className="h-8 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-sm text-gray-600">
                      {user.name || 'No name'} · {user.is_active ? 'Active' : 'Inactive'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleResetPassword(user.id)}>
                        Reset Password
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteUser(user.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
