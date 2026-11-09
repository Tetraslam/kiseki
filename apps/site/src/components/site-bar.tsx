import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

const links = [
  { href: "/docs", label: "docs" },
  { href: "https://github.com/tetraslam/kiseki", label: "github" },
  { href: "/llms.txt", label: "for agents" },
];

export function SiteBar() {
  return (
    <header className="mx-auto flex h-14 w-full max-w-[1160px] items-center gap-6 px-5">
      <Link href="/" className="flex items-baseline gap-2 font-medium tracking-tight">
        <span className="font-display text-[17px] leading-none">軌跡</span>
        <span className="text-[15px]">kiseki</span>
      </Link>
      <nav className="ml-auto flex items-center gap-1 text-sm text-ink-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-[4px] px-2.5 py-1.5 transition-colors duration-[90ms] ease-track hover:bg-muted hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
        <ThemeToggle />
      </nav>
    </header>
  );
}
