import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";

// `min-h-screen` (not a fixed `h-screen`) lets the page grow taller than the
// viewport when content needs more room, with the browser's own scrollbar
// handling it — no `overflow-hidden` anywhere in this shell, since that's
// exactly what clips content at high zoom / on smaller screens. `min-w-0` on
// the content column is the flexbox fix for the sibling Sidebar's fixed
// width: without it, a flex item's default `min-width: auto` stops it from
// ever shrinking below its content's intrinsic width, which is what pushes
// wide content (tables, forms) past the viewport instead of letting it
// scroll horizontally inside its own container.
const Layout = () => {
  return (
    <div className="flex min-h-screen" style={{ background: "linear-gradient(160deg, #EEF6FB 0%, #F4F9F6 45%, #EAF6EF 100%)" }}>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 min-w-0 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;

