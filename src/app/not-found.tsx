import { SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-[560px] flex-col justify-center gap-4 px-4 py-10">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 sm:p-8">
        <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-[10px] bg-brand-soft text-primary">
          <SearchX className="size-5" />
        </span>
        <h1 className="text-xl font-bold">페이지를 찾을 수 없습니다</h1>
        <p className="text-muted-foreground">주소가 바뀌었거나 없는 페이지입니다.</p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          처음으로
        </Link>
      </div>
    </main>
  );
}
