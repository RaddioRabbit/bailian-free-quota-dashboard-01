"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SOURCE_URL_EXAMPLES = [
  "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen%2Cmini-max%2Cmoonshot-ai%2Czhipu-ai%2Cdeepseek&capabilities=Multimodal-Omni%2CTG%2CReasoning%2CVU%2CIG",
  "https://bailian.console.aliyun.com/cn-beijing#/model-market/all?providers=qwen%2Cmini-max%2Cmoonshot-ai%2Czhipu-ai%2Cdeepseek&capabilities=TG%2CReasoning%2CVU%2CIG",
];

interface SourceConfigResponse {
  sourceUrls?: string[];
}

export function SourceConfigPage() {
  const router = useRouter();
  const [sourceText, setSourceText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [configRes, authRes] = await Promise.all([
          fetch("/api/source-config"),
          fetch("/api/auth"),
        ]);

        const config = await configRes.json() as SourceConfigResponse;
        const auth = await authRes.json() as { loggedIn?: boolean };

        setSourceText((config.sourceUrls || []).join("\n"));
        setLoggedIn(Boolean(auth.loggedIn));
      } catch {
        toast.error("加载抓取配置失败");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/source-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrls: sourceText }),
      });
      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "保存抓取配置失败");
      }

      toast.success("抓取配置已保存");
      // 带上 ?refresh=1 标记，dashboard 检测到后会自动触发与点击「刷新」等价的抓取流程
      router.push("/?refresh=1");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存抓取配置失败");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">抓取配置</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              登录完成后，在这里填写要抓取的百炼模型广场页面链接。
            </p>
          </div>
          <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回首页
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>模型广场页面</CardTitle>
            <CardDescription>
              支持多条 URL，按行输入。系统会按照这些页面的并集去抓取模型。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isLoading && !loggedIn && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                请先回到首页登录阿里云账号，再保存抓取配置。
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">抓取页面 URL</label>
              <textarea
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                rows={8}
                placeholder={SOURCE_URL_EXAMPLES.join("\n")}
                className="min-h-[220px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>

            <div className="rounded-xl border bg-muted/20 px-4 py-3">
              <div className="text-sm font-medium">示例</div>
              <div className="mt-2 flex flex-col gap-2 text-xs text-muted-foreground">
                {SOURCE_URL_EXAMPLES.map((exampleUrl) => (
                  <code key={exampleUrl} className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-background px-2 py-1">
                    {exampleUrl}
                  </code>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
                取消
              </Link>
              <Button onClick={() => void handleSave()} disabled={isLoading || isSaving || !loggedIn}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                保存并开始抓取
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
