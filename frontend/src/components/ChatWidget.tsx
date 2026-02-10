import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import Chat from '@/pages/Chat';

interface ChatWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ChatWidget({ open, onOpenChange }: ChatWidgetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] h-[84vh] p-0 overflow-hidden border shadow-2xl flex flex-col gap-0">
        <DialogHeader className="px-5 py-3 border-b bg-white flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-lg text-slate-900">Team Chat Widget</DialogTitle>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close chat modal">
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-slate-50">
          <Chat embedded />
        </div>
      </DialogContent>
    </Dialog>
  );
}
