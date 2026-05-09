export type InputState = {
  mvx: number;
  mvy: number;
  mouseX: number;
  mouseY: number;
  flashlight: boolean;
  interact: boolean;
  drop: boolean;
  selectedSlot: number;
  chatOpen: boolean;
  terminalOpen: boolean;
  voiceActive: boolean;
};

export class InputController {
  state: InputState = {
    mvx: 0,
    mvy: 0,
    mouseX: 0,
    mouseY: 0,
    flashlight: false,
    interact: false,
    drop: false,
    selectedSlot: 0,
    chatOpen: false,
    terminalOpen: false,
    voiceActive: false,
  };
  private down = new Set<string>();
  private edge = {
    interact: false,
    drop: false,
    chatToggle: false,
    terminalToggle: false,
    flashlightToggle: false,
    voicePressed: false,
    voiceReleased: false,
  };
  private canvas: HTMLCanvasElement | null = null;
  private uiHasFocus = () => false;

  attach(canvas: HTMLCanvasElement, uiHasFocus: () => boolean): void {
    this.canvas = canvas;
    this.uiHasFocus = uiHasFocus;
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mouseup", this.onMouseUp);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    if (this.canvas) {
      this.canvas.removeEventListener("mousemove", this.onMouseMove);
      this.canvas.removeEventListener("mousedown", this.onMouseDown);
      this.canvas.removeEventListener("mouseup", this.onMouseUp);
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas!.getBoundingClientRect();
    this.state.mouseX = e.clientX - rect.left;
    this.state.mouseY = e.clientY - rect.top;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.edge.interact = true;
  };
  private onMouseUp = (_e: MouseEvent) => {
    /* no-op for now */
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.uiHasFocus()) return;
    const k = e.key;
    const lower = k.toLowerCase();
    if (this.down.has(lower)) return;
    this.down.add(lower);
    switch (lower) {
      case "w":
      case "a":
      case "s":
      case "d":
      case "arrowup":
      case "arrowdown":
      case "arrowleft":
      case "arrowright":
        this.recomputeMove();
        break;
      case "e":
        this.edge.interact = true;
        break;
      case "g":
        this.edge.drop = true;
        break;
      case "f":
        this.edge.flashlightToggle = true;
        break;
      case "v":
        if (!this.state.voiceActive) {
          this.state.voiceActive = true;
          this.edge.voicePressed = true;
        }
        break;
      case "enter":
        this.edge.chatToggle = true;
        break;
      case "tab":
        e.preventDefault();
        this.edge.terminalToggle = true;
        break;
      case "1":
      case "2":
      case "3":
      case "4":
        this.state.selectedSlot = parseInt(lower, 10) - 1;
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const lower = e.key.toLowerCase();
    this.down.delete(lower);
    switch (lower) {
      case "w":
      case "a":
      case "s":
      case "d":
      case "arrowup":
      case "arrowdown":
      case "arrowleft":
      case "arrowright":
        this.recomputeMove();
        break;
      case "v":
        if (this.state.voiceActive) {
          this.state.voiceActive = false;
          this.edge.voiceReleased = true;
        }
        break;
    }
  };

  private recomputeMove(): void {
    let mx = 0,
      my = 0;
    if (this.down.has("w") || this.down.has("arrowup")) my -= 1;
    if (this.down.has("s") || this.down.has("arrowdown")) my += 1;
    if (this.down.has("a") || this.down.has("arrowleft")) mx -= 1;
    if (this.down.has("d") || this.down.has("arrowright")) mx += 1;
    if (this.uiHasFocus()) {
      mx = 0;
      my = 0;
    }
    this.state.mvx = mx;
    this.state.mvy = my;
  }

  // Returns and clears all edge events
  consumeEdges() {
    const out = { ...this.edge };
    this.edge.interact = false;
    this.edge.drop = false;
    this.edge.chatToggle = false;
    this.edge.terminalToggle = false;
    this.edge.flashlightToggle = false;
    this.edge.voicePressed = false;
    this.edge.voiceReleased = false;
    return out;
  }

  forceRefocus(): void {
    this.recomputeMove();
  }
}
