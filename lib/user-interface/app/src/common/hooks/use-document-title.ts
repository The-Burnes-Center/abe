import { useEffect } from "react";

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} | Sonar`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
