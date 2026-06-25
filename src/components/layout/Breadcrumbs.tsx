import { Fragment } from "react";
import { ChevronRight, Home } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

import { ROUTE_TITLES } from "@/lib/routeTitles";

const routeNames: Record<string, string> = ROUTE_TITLES;

export const Breadcrumbs = () => {
  const location = useLocation();
  const pathnames = location.pathname.split("/").filter((x) => x);

  if (pathnames.length <= 1) return null;

  // Filtra "dashboard" — fica fora do loop pra evitar separator órfão
  const items = pathnames
    .map((pathname, index) => ({ pathname, index }))
    .filter((p) => p.pathname !== "dashboard");

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/dashboard" className="flex items-center gap-1" aria-label="Início">
              <Home className="h-4 w-4" />
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {items.map(({ pathname, index }, i) => {
          const routeTo = `/${pathnames.slice(0, index + 1).join("/")}`;
          const isLast = i === items.length - 1;
          const label = routeNames[pathname] || pathname;

          return (
            <Fragment key={pathname}>
              <BreadcrumbSeparator>
                <ChevronRight className="h-4 w-4" />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={routeTo}>{label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
