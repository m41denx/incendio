import { type FC, type ReactNode, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Col } from "@canonical/react-components";

/**
 * A section of a detail page, as Incendio's overviews lay them out: the heading on the left, the
 * content beside it. A link ending in `#<id>` scrolls to it.
 */
const Section: FC<{ title: ReactNode; id: string; children: ReactNode }> = ({ title, id, children }) => {
  const { hash } = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hash !== `#${id}`) return;
    // The sections above may still be loading and push this one down, so keep it in view for a
    // moment, until the reader scrolls themselves.
    const scroll = () => heading.current?.scrollIntoView({ block: "start" });
    scroll();
    const timer = setInterval(scroll, 150);
    const stop = () => clearInterval(timer);
    const until = setTimeout(stop, 3000);
    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
    return () => {
      stop();
      clearTimeout(until);
      events.forEach((e) => window.removeEventListener(e, stop));
    };
  }, [hash, id]);
  return (
    <section className="row" aria-labelledby={id}>
      <Col size={3}>
        <h2 id={id} ref={heading} className="p-heading--5">
          {title}
        </h2>
      </Col>
      <Col size={9}>{children}</Col>
    </section>
  );
};

export default Section;
