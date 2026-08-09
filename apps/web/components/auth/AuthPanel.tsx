"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

export function AuthPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="zipo-auth-stage zipo-safe-x">
      <div className="zipo-auth-beam" aria-hidden="true" />
      <motion.main
        className="zipo-auth-card"
        initial={{ opacity: 0, y: 18, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="zipo-auth-heading">
          <p>ZiPo / access</p>
          <h1>{title}</h1>
        </header>
        {children}
      </motion.main>
    </div>
  );
}
