import { GYFTR_LOGO_URI } from "./logoData";

export function GyftrLogo({ h = 24 }: { h?: number }) {
  return <img src={GYFTR_LOGO_URI} alt="GYFTR" style={{ height: h, width: "auto", display: "block" }} draggable={false} />;
}
