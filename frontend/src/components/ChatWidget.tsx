import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Chat from '@/pages/Chat';

interface ChatWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ChatWidget({ open, onOpenChange }: ChatWidgetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] h-[84vh] p-0 overflow-hidden border-0 shadow-2xl">
        <DialogHeader className="px-6 py-4 border-b bg-white">
          <DialogTitle className="text-lg">Team Chat Widget</DialogTitle>
        </DialogHeader>
        <div className="h-full bg-slate-50">
          <Chat embedded />
        </div>
      </DialogContent>
    </Dialog>
  );
}
