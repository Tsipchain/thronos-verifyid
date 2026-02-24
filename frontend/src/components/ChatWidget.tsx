import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import Chat from '@/pages/Chat';

interface ChatWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ChatWidget({ open, onOpenChange }: ChatWidgetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* p-0: no padding so Chat fills the entire dialog
          flex flex-col: child can use flex-1 to fill height
          [&>button]:z-50: keep the default × close button on top */}
      <DialogContent
        className="max-w-5xl w-[95vw] p-0 overflow-hidden flex flex-col gap-0 [&>button]:z-50"
        style={{ height: 'min(88vh, 880px)' }}
      >
        {/* Visually-hidden title satisfies dialog accessibility requirements */}
        <DialogTitle className="sr-only">Team Chat</DialogTitle>
        <Chat embedded onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
