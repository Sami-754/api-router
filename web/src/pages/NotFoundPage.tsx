import { Link } from "react-router-dom";
import { Button } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="page notfound">
      <span className="notfound__code">404</span>
      <h1>Page not found</h1>
      <p className="muted">That route does not exist in this dashboard.</p>
      <Link to="/">
        <Button variant="primary" icon="gauge">
          Back to dashboard
        </Button>
      </Link>
    </div>
  );
}
