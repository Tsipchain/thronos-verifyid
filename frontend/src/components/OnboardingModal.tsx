import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Sparkles, MessageSquare, Users, Shield, Zap, Video, TrendingUp } from "lucide-react";

interface OnboardingModalProps {
  userRole: "agent" | "manager" | "admin";
  userName: string;
}

export default function OnboardingModal({ userRole, userName }: OnboardingModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem(`onboarding_${userRole}`);
    if (!hasSeenOnboarding) {
      setTimeout(() => setOpen(true), 500); // Slight delay for better UX
    }
  }, [userRole]);

  const handleComplete = () => {
    localStorage.setItem(`onboarding_${userRole}`, "true");
    setOpen(false);
  };

  const features = {
    agent: [
      {
        icon: <Video className="h-5 w-5 text-blue-600" />,
        title: "Video KYC Calls",
        description: "Accept and verify customer identity via live video calls with WebRTC",
      },
      {
        icon: <Sparkles className="h-5 w-5 text-purple-600" />,
        title: "AI Assistant",
        description: "Get AI-powered fraud detection suggestions during verification (10 credits/request)",
      },
      {
        icon: <MessageSquare className="h-5 w-5 text-green-600" />,
        title: "Team Chat",
        description: "Communicate with managers and other agents in real-time",
      },
      {
        icon: <Shield className="h-5 w-5 text-orange-600" />,
        title: "Blockchain Audit Trail",
        description: "All verifications are anchored on Thronos Chain for immutability",
      },
    ],
    manager: [
      {
        icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
        title: "Final Approval Authority",
        description: "Review and finalize agent-approved verifications with full audit history",
      },
      {
        icon: <Sparkles className="h-5 w-5 text-purple-600" />,
        title: "AI Analytics",
        description: "Analyze patterns, spot trends, and get AI insights (10 credits/request)",
      },
      {
        icon: <TrendingUp className="h-5 w-5 text-blue-600" />,
        title: "Performance Dashboard",
        description: "Monitor agent performance, success rates, and team metrics",
      },
      {
        icon: <Users className="h-5 w-5 text-indigo-600" />,
        title: "Team Management",
        description: "Manage agents, assign roles, and oversee team chat",
      },
    ],
    admin: [
      {
        icon: <Shield className="h-5 w-5 text-red-600" />,
        title: "Full System Access",
        description: "Manage all users, roles, permissions, and system configuration",
      },
      {
        icon: <Sparkles className="h-5 w-5 text-purple-600" />,
        title: "Unlimited AI Access",
        description: "Use AI Assistant without credit limits for system administration",
      },
      {
        icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
        title: "Blockchain Management",
        description: "Monitor on-chain transactions, fee gateway, and immutable audit trail",
      },
      {
        icon: <Zap className="h-5 w-5 text-yellow-600" />,
        title: "Billing & Credits",
        description: "Manage subscriptions, credits, Stripe/BTC payments, and fee-to-THRONOS gateway",
      },
    ],
  };

  const currentFeatures = features[userRole];
  const roleColors = {
    agent: "bg-blue-100 text-blue-800",
    manager: "bg-purple-100 text-purple-800",
    admin: "bg-red-100 text-red-800",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <span>Welcome to Thronos VerifyID, {userName}!</span>
            <span className="text-2xl">🎉</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Role Badge */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge className={`text-sm font-semibold ${roleColors[userRole]}`}>
              {userRole.toUpperCase()} ROLE
            </Badge>
            <Badge variant="outline" className="text-sm text-green-600 border-green-300">
              <Sparkles className="h-3 w-3 mr-1" />
              50 FREE AI CREDITS
            </Badge>
          </div>

          {/* Welcome Message */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg border">
            <p className="text-slate-700 text-sm">
              You're all set! Here's what you can do with your <b>{userRole}</b> account:
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid gap-3">
            {currentFeatures.map((feature, idx) => (
              <div key={idx} className="flex gap-3 p-4 rounded-lg border bg-white hover:shadow-sm transition-shadow">
                <div className="mt-0.5 flex-shrink-0">{feature.icon}</div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-900">{feature.title}</h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Credit Info */}
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-lg border border-purple-200">
            <h4 className="font-semibold text-sm text-purple-900 mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI Assistant Credits
            </h4>
            <p className="text-xs text-purple-700 mb-3">
              Your AI Assistant uses <b>10 credits per request</b>. Need more? Purchase credit packages:
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white/70 p-2 rounded border border-purple-100">
                <span className="font-semibold">Starter</span>: 100 credits — €1.00
              </div>
              <div className="bg-white/70 p-2 rounded border border-purple-100">
                <span className="font-semibold">Basic</span>: 500 credits — €4.00
              </div>
              <div className="bg-white/70 p-2 rounded border border-purple-100">
                <span className="font-semibold">Pro</span>: 1,500 credits — €10.00 <span className="text-green-600">(33% off)</span>
              </div>
              <div className="bg-white/70 p-2 rounded border border-purple-100">
                <span className="font-semibold">Enterprise</span>: 5,000 credits — €30.00 <span className="text-green-600">(40% off)</span>
              </div>
            </div>
          </div>

          {/* CTA Button */}
          <Button 
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700" 
            onClick={handleComplete}
            size="lg"
          >
            Got it! Let's start →
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
