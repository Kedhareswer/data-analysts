"use client";

import dynamic from "next/dynamic";

const ChatBotDemo = dynamic(
  () => import("@/components/chat/ChatLayout"),
  { ssr: false }
);

export default function HomePage() {
  return <ChatBotDemo />;
}
