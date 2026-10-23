"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actionUser } from "@/auth/current";
import { DEMO_COOKIE, SESSION_COOKIE } from "@/auth/session";
import { deleteUser } from "@/auth/users";
import { getAppDb } from "@/db/client";

// 탈퇴(4.1-6). 계정과 가계부 데이터를 지우고 쿠키를 지운 뒤 소개 화면으로 간다.
export async function deleteAccountAction(): Promise<void> {
  const user = await actionUser();
  await deleteUser(getAppDb(), user.id);
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(DEMO_COOKIE);
  redirect("/");
}
