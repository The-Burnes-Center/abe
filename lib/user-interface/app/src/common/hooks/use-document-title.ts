import { useEffect } from "react";
import { brand } from "../brand";

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} | ${brand.shortName}`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
