import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { getAPIBaseURL } from '@/lib/config';
import Index from './pages/Index';
import NotFound from './pages/NotFound';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import CallAgentDashboard from './pages/CallAgentDashboard';
import ClientPortal from './pages/ClientPortal';
import Login from './pages/Login';
import Register from './pages/Register';

const queryClient = new QueryClient();

const App = () => {
  let configError: string | null = null;

  try {
    getAPIBaseURL();
  } catch (error) {
    configError = error instanceof Error ? error.message : 'Missing VITE_API_BASE_URL in production';
  }

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 p-6">
        <div className="max-w-lg text-center space-y-3">
          <h1 className="text-2xl font-semibold">Configuration Error</h1>
          <p className="text-slate-300">{configError}</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/admin" element={<Dashboard />} />
            <Route path="/agent" element={<CallAgentDashboard />} />
            <Route path="/client" element={<ClientPortal />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/dashboard/call-agent" element={<CallAgentDashboard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
