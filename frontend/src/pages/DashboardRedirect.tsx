import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/lib/auth';

export default function DashboardRedirect() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const redirectByRole = async () => {
      const user = await authApi.getCurrentUser();
      if (!user) {
        navigate('/login', { replace: true });
        return;
      }

      const role = user.role;
      if (role === 'admin' || role === 'manager') {
        navigate('/admin', { replace: true });
      } else if (role === 'agent') {
        navigate('/agent', { replace: true });
      } else {
        navigate('/client', { replace: true });
      }

      if (isActive) {
        setLoading(false);
      }
    };

    redirectByRole();

    return () => {
      isActive = false;
    };
  }, [navigate]);

  if (!loading) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  );
}
