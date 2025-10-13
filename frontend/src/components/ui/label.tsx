import * as React from "react";
import { cn } from "../../lib/utils";

type LabelElement = HTMLLabelElement;

const Label = React.forwardRef<LabelElement, React.LabelHTMLAttributes<LabelElement>>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn("text-xs font-semibold uppercase tracking-wide text-slate-400", className)} {...props} />
));
Label.displayName = "Label";

export { Label };
