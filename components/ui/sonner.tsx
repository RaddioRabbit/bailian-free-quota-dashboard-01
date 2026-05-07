"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      offset={{ right: 24, bottom: 24 }}
      mobileOffset={{ right: 16, bottom: 16, left: 16 }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !bg-white !text-slate-900 !border !border-slate-200 !shadow-lg !opacity-100 !backdrop-blur-none",
          title: "!text-slate-900",
          description: "!text-slate-600",
          loading: "!bg-white !text-slate-900 !border-slate-200",
          success: "!bg-white !text-slate-900 !border-slate-200",
          error: "!bg-white !text-slate-900 !border-slate-200",
          info: "!bg-white !text-slate-900 !border-slate-200",
          warning: "!bg-white !text-slate-900 !border-slate-200",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
