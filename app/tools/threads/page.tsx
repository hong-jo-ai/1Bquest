import AppHeader from "@/components/AppHeader";
import ThreadsStudio from "@/components/threads/ThreadsStudio";

export default function ThreadsPage() {
  return (
    <>
      <AppHeader refreshHref="/tools/threads" />
      <ThreadsStudio />
    </>
  );
}
