import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { SpaceScene } from "./SpaceScene";

export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current!,
      backgroundColor: "#16181d",
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: "100%",
        height: "100%",
      },
      scene: [SpaceScene],
    });
    return () => game.destroy(true);
  }, []);

  return <div ref={hostRef} className="game-canvas" />;
}
