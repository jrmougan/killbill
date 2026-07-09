import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    gradient?: boolean;
}

export function GlassCard({ children, className, gradient, ...props }: GlassCardProps) {
    return (
        <div
            className={cn(
                "bg-card border border-[color:var(--line)] p-4 rounded-2xl transition-all duration-300",
                gradient && "bg-gradient-to-br from-secondary to-transparent",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
