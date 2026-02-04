import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rbac } from '@/lib/rbac';
import { authApi } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import AIAssistantModal from '@/components/AIAssistantModal';
import LanguageSelector from '@/components/LanguageSelector';
import ThemeToggle from '@/components/ThemeToggle';
import { 
  Shield, 
  MessageSquare,
  Users,
  Settings,
  FileCheck,
  BarChart3,
  LogOut,
  Bot
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

interface UserData {
  email: string;
  role?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [aiModalOpen, setAiModalOpen] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const userData = await authApi.getCurrentUser();
      if (!userData) {
        navigate('/login');
        return;
      }

      setUser(userData as UserData);
      
      await rbac.initialize();
      const userRoles = rbac.getRoles();
      setRoles(userRoles.map(r => r.display_name));
      
      setLoading(false);
    } catch (error) {
      console.error('Auth error:', error);
      navigate('/login');
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      navigate('/login');
    } catch (error) {
      toast({
        title: t('error'),
        description: 'Failed to logout',
        variant: 'destructive'
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t('loading')}</p>
        </div>
      </div>
    );
  }

  const menuItems = [
    {
      title: t('verifications'),
      description: 'Manage identity verifications',
      icon: FileCheck,
      path: '/admin/verifications',
      show: rbac.canAccessVerifications(),
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20'
    },
    {
      title: t('chat'),
      description: 'Team communication',
      icon: MessageSquare,
      path: '/admin/chat',
      show: rbac.canAccessChat(),
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/20'
    },
    {
      title: t('users'),
      description: 'User management',
      icon: Users,
      path: '/admin/users',
      show: rbac.canAccessUsers(),
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20'
    },
    {
      title: t('reports'),
      description: 'Analytics and reports',
      icon: BarChart3,
      path: '/admin/reports',
      show: rbac.canAccessReports(),
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-900/20'
    },
    {
      title: t('settings'),
      description: 'System settings',
      icon: Settings,
      path: '/admin/settings',
      show: rbac.canAccessSettings(),
      color: 'text-gray-600 dark:text-gray-400',
      bgColor: 'bg-gray-50 dark:bg-gray-900/20'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-blue-900 pb-20">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Identity Verification Platform</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">Secure verification management system</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAiModalOpen(true)}
                className="gap-2"
              >
                <Bot className="h-4 w-4" />
                AI Assistant
              </Button>
              <LanguageSelector />
              <ThemeToggle />
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{user?.email}</p>
                <div className="flex gap-1 justify-end mt-1">
                  {roles.map((role, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {role}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                {t('logout')}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{t('welcome')} back!</h2>
          <p className="text-gray-600 dark:text-gray-400">Select a module to get started</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {menuItems.filter(item => item.show).map((item, index) => (
            <Card 
              key={index}
              className="hover:shadow-lg transition-shadow cursor-pointer group dark:bg-gray-800 dark:border-gray-700"
              onClick={() => navigate(item.path)}
            >
              <CardHeader>
                <div className={`w-12 h-12 rounded-lg ${item.bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
                <CardTitle className="dark:text-white">{item.title}</CardTitle>
                <CardDescription className="dark:text-gray-400">{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="ghost" className="w-full group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20">
                  Open Module →
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          {rbac.canAccessVerifications() && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending Verifications</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">12</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Awaiting review</p>
              </CardContent>
            </Card>
          )}
          
          {rbac.canAccessChat() && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Unread Messages</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">5</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">New messages</p>
              </CardContent>
            </Card>
          )}
          
          {rbac.canAccessUsers() && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Active Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">24</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Currently online</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <AIAssistantModal open={aiModalOpen} onOpenChange={setAiModalOpen} />
      {rbac.canAccessChat() && (
        <footer className="fixed bottom-0 left-0 right-0 border-t bg-white/90 backdrop-blur dark:bg-gray-900/90">
          <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Team communication
            </span>
            <Button size="sm" onClick={() => navigate('/admin/chat')} className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Open Team Chat
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
