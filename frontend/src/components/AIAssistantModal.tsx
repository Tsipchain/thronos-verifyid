import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Send, Loader2, Coins, ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AIAssistantModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Aligned with Thronos AI Core model IDs
const VERIFYID_MODEL = 'claude-sonnet-4-5-20250929';

export default function AIAssistantModal({ open, onOpenChange }: AIAssistantModalProps) {
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);

  // Fetch credit balance when modal opens
  useEffect(() => {
    if (open) {
      fetchCredits();
    }
  }, [open]);

  const fetchCredits = async () => {
    setLoadingCredits(true);
    try {
      const response = await apiClient.get<{ balance: number }>('/api/v1/credits/balance');
      setCredits(response.data.balance);
    } catch {
      // ignore — user may not be logged in yet
    } finally {
      setLoadingCredits(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const languageNames: Record<string, string> = {
        en: 'English',
        gr: 'Greek',
        ger: 'German',
        ru: 'Russian',
        tur: 'Turkish',
        ita: 'Italian',
        esp: 'Spanish'
      };

      const systemPrompt = `You are the Thronos VerifyID AI Assistant — an expert platform guide and document fraud detection specialist.
The user is currently using the interface in ${languageNames[language] ?? 'English'}.
Respond in ${languageNames[language] ?? 'English'} to match their language preference.
Help with:
- Document upload guidance and verification status
- Document requirements per country and document type
- Account and platform usage questions
- Document fraud detection and red flags
Be concise, friendly, and professional. When uncertain about fraud indicators, always recommend supervisor escalation.`;

      const response = await apiClient.post<{
        content: string;
        credits_used: number;
        credits_remaining: number;
      }>('/api/v1/aihub/thronos-chat',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
          ],
          model: VERIFYID_MODEL,
          temperature: 0.3
        }
      );

      const assistantMessage = response.data.content;
      setMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);

      // Update credit balance from response
      if (response.data.credits_remaining !== undefined) {
        setCredits(response.data.credits_remaining);
      }
    } catch (error) {
      const errObj = error as { data?: { detail?: string }; response?: { data?: { detail?: string }; status?: number }; message?: string };
      const detail =
        errObj?.data?.detail ||
        errObj?.response?.data?.detail ||
        errObj?.message ||
        'Failed to get response';

      const status = errObj?.response?.status;
      if (status === 402) {
        toast({
          title: 'Insufficient Credits',
          description: `${detail} — Click "Buy Credits" to top up.`,
          variant: 'destructive'
        });
      } else {
        toast({
          title: 'Error',
          description: detail,
          variant: 'destructive'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleBuyCredits = () => {
    // Navigate to credits purchase page
    window.location.href = '/credits';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[600px] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-600" />
              {t('aiAssistant')}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {loadingCredits ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              ) : credits !== null ? (
                <Badge
                  variant={credits < 20 ? 'destructive' : 'secondary'}
                  className="flex items-center gap-1 text-xs"
                >
                  <Coins className="h-3 w-3" />
                  {credits} credits
                </Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={handleBuyCredits}
                className="flex items-center gap-1 text-xs h-7 px-2"
              >
                <ShoppingCart className="h-3 w-3" />
                Buy Credits
              </Button>
            </div>
          </div>
          <DialogDescription>
            {t('howCanHelp')}
            {credits !== null && credits < 20 && (
              <span className="text-orange-500 ml-2">⚠ Low credits — each message costs 10 credits.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Bot className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>{t('askQuestion')}</p>
                <p className="text-xs text-gray-400 mt-2">Powered by Thronos AI Core · {VERIFYID_MODEL}</p>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-5 w-5 text-blue-600" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-5 w-5 text-blue-600" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex gap-2 pt-4 border-t">
          <Textarea
            placeholder={t('askQuestion')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="resize-none"
            rows={2}
          />
          <div className="flex flex-col gap-1">
            <Button onClick={sendMessage} disabled={loading || !input.trim()} size="icon">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
            {credits !== null && (
              <span className="text-[10px] text-gray-400 text-center">-10 cr</span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
