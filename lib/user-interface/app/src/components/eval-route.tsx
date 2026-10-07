/**
 * Guard for the Quality Monitoring pages. Stacks deployed with
 * `-c enableEval=false` have no eval APIs, so a direct link to these pages
 * would only produce errors; send admins to the Data page instead.
 */
import { useContext } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { AppContext } from "../common/app-context";

export default function EvalRoute() {
  const appContext = useContext(AppContext);
  if (appContext?.evalEnabled === false) return <Navigate to="/admin/data" replace />;
  return <Outlet />;
}
