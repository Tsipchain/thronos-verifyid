import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Chat from '@/pages/Chat';

interface ChatWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ChatWidget({ open, onOpenChange }: ChatWidgetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[80vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Team Chat</DialogTitle>
        </DialogHeader>
        <div className="h-full pb-6">
          <Chat embedded />
        </div>
      </DialogContent>
    </Dialog>
  );
}
