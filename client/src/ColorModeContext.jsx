import { createContext, useContext } from "react";

export const ColorModeContext = createContext({ mode: "light", toggle: () => {} });
export const useColorMode = () => useContext(ColorModeContext);
