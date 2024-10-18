import { useCallback } from "react";
import { useNavigate } from "react-router";

interface FollowDetail {
  external?: boolean;
  href?: string;
}

export default function useOnFollow() {
  const navigate = useNavigate();

  return useCallback(
    (event: CustomEvent<FollowDetail>): void => {
      if (!event.detail || event.detail.external || typeof event.detail.href === "undefined") {
        return;
      }

      event.preventDefault();
      navigate(event.detail.href);
    },
    [navigate]
  );
}
