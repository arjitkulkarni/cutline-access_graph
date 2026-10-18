"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring } from "motion/react";
import { ArrowRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/format";
import { NAV_LINKS } from "./data";
import { EASE_CUT, Roll } from "./primitives";

/** Landing mark: two nodes, the relation between them cut by a blood-red slash. */
export function CutMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="5" cy="10" r="2.2" stroke="#ece6dc" strokeWidth="1.4" />
      <circle cx="15" cy="10" r="2.2" stroke="#ece6dc" strokeWidth="1.4" />
      <path d="M7.4 10h1.4M11.2 10h1.4" stroke="#716b65" strokeWidth="1.4" />
      <path d="M8.6 15.2 11.4 4.8" stroke="#e3182f" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 160, damping: 32, mass: 0.3 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // "Repair" covers the whole scroll story (trace → verify).
    const groups: Array<[string, string[]]> = NAV_LINKS.map((l) =>
      l.href === "#trace" ? [l.href, ["trace", "reject", "cut", "verify"]] : [l.href, [l.href.slice(1)]],
    );
    const owner = new Map<string, string>();
    groups.forEach(([href, ids]) => ids.forEach((id) => owner.set(id, href)));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(owner.get(e.target.id) ?? null);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    owner.forEach((_, id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    // Back on the hero: nothing is active.
    const hero = document.querySelector("[data-step='0']");
    const topIo = new IntersectionObserver(([e]) => e.isIntersecting && setActive(null), { threshold: 0.6 });
    if (hero) topIo.observe(hero);
    return () => {
      io.disconnect();
      topIo.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={cn("lp-nav", (scrolled || open) && "lp-nav--scrolled", open && "lp-nav--open")}>
      <motion.div className="lp-nav-progress" style={{ scaleX: progress }} aria-hidden />
      <div className="lp-container flex h-16 items-center gap-6">
        <a href="#top" className="flex items-center gap-3" aria-label="CUTLINE, back to top">
          <CutMark size={24} />
          <span className="text-[13px] font-semibold tracking-[0.32em] text-[var(--lp-bone)]">CUTLINE</span>
        </a>

        <nav aria-label="Sections" className="ml-auto hidden items-center gap-2 lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} data-active={active === l.href} className="lp-nav-link pl-3">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          <a href="/overview" className="lp-btn lp-btn-primary lp-btn-sm">
            <Roll>Console</Roll>
            <ArrowRight size={13} aria-hidden />
          </a>
          <button
            type="button"
            className="lp-icon-btn lg:hidden"
            aria-expanded={open}
            aria-controls="lp-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={17} aria-hidden /> : <Menu size={17} aria-hidden />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.nav
            id="lp-mobile-nav"
            aria-label="Sections"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.45, ease: EASE_CUT }}
            className="overflow-hidden border-t border-[var(--lp-line)] lg:hidden"
          >
            <div className="lp-container grid py-2">
              {NAV_LINKS.map((l, i) => (
                <motion.a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  data-active={active === l.href}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease: EASE_CUT, delay: 0.08 + i * 0.04 }}
                  className="lp-nav-link lp-nav-link--block flex items-baseline gap-4 border-b border-[var(--lp-line)] last:border-b-0"
                >
                  <span className="text-[var(--lp-red)]">{String(i + 1).padStart(2, "0")}</span>
                  {l.label}
                </motion.a>
              ))}
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
