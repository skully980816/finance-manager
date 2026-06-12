"use client";
import { createContext, useContext, useEffect, useState } from "react";

type EntityCtx = {
  /** Selected business id, or "all" */
  selected: number | "all";
  setSelected: (v: number | "all") => void;
};

const Ctx = createContext<EntityCtx>({ selected: "all", setSelected: () => {} });

export function EntityProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelectedState] = useState<number | "all">("all");

  useEffect(() => {
    const saved = localStorage.getItem("ledger.entity");
    if (saved) setSelectedState(saved === "all" ? "all" : Number(saved));
  }, []);

  const setSelected = (v: number | "all") => {
    setSelectedState(v);
    localStorage.setItem("ledger.entity", String(v));
  };

  return <Ctx.Provider value={{ selected, setSelected }}>{children}</Ctx.Provider>;
}

export const useEntity = () => useContext(Ctx);

/** Append ?entity_id= to an API path unless "all" is selected. */
export function withEntity(path: string, selected: number | "all") {
  if (selected === "all") return path;
  return path + (path.includes("?") ? "&" : "?") + `entity_id=${selected}`;
}
