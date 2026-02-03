import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api';
import { rbac } from '@/lib/rbac';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Users } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  is_active: boolean;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

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

        const response = await apiClient.get<AdminUser[]>('/api/v1/admin/users');
        setUsers(response.data);
      } catch (err) {
        console.error('Failed to load users', err);
        setError('Failed to load users.');
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, [navigate, toast]);

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
                    className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">{user.email}</p>
                      <span className="text-xs uppercase tracking-wide text-gray-500">{user.role}</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      {user.name || 'No name'} · {user.is_active ? 'Active' : 'Inactive'}
                    </p>
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
