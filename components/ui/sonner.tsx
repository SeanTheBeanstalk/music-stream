"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      richColors
      toastOptions={{
        ...props.toastOptions,
        style: {
          width: "fit-content",
          maxWidth: "calc(100vw - 2rem)",
          left: 0,
          right: 0,
          marginInline: "auto",
          background: "var(--muted)",
          color: "var(--foreground)",
          borderColor: "var(--border)",
          ...props.toastOptions?.style,
        },
      }}
      {...props}
    />
  );
}
