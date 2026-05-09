export type InputState = {
  mvx: number;
  mvy: number;
  mouseX: number;
  mouseY: number;
  selectedSlot: number;
  voiceActive: boolean;
};

// Edges drained every frame for UI (toggling chat, terminal, flashlight, voice)
type UiEdges = {
  chatToggle: boolean;
  terminalToggle: boolean;
  flashlightToggle: boolean;
  voicePressed: boolean;
  voiceReleased: boolean;
};

// Edges drained only when an input message is sent to the server.
// This prevents drop/interact events from being eaten on frames where we don't transmit.
type NetEdges = {
  interact: boolean;
  drop: boolean;
};

export class InputController {
  state: InputState = {
    mvx: 0,
    mvy: 0,
    mouseX: 0,
    mouseY: 0,
    selectedSlot: 0,
    voiceActive: false,
  };
  private down = new Set<string>();
  private uiEdges: UiEdges = {
    chatToggle: false,
    terminalToggle: false,
    flashlightToggle: false,
    voicePressed: false,
    voiceReleased: false,
  };
  private netEdges: NetEdges = { interact: false, drop: false };
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
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    if (this.canvas) {
      this.canvas.removeEventListener("mousemove", this.onMouseMove);
      this.canvas.removeEventListener("mousedown", this.onMouseDown);
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas!.getBoundingClientRect();
    this.state.mouseX = e.clientX - rect.left;
    this.state.mouseY = e.clientY - rect.top;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.uiHasFocus()) return;
    if (e.button === 0) this.netEdges.interact = true;
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.uiHasFocus()) return;
    const lower = e.key.toLowerCase();
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
        this.netEdges.interact = true;
        break;
      case "g":
        this.netEdges.drop = true;
        break;
      case "f":
        this.uiEdges.flashlightToggle = true;
        break;
      case "v":
        if (!this.state.voiceActive) {
          this.state.voiceActive = true;
          this.uiEdges.voicePressed = true;
        }
        break;
      case "enter":
        this.uiEdges.chatToggle = true;
        break;
      case "tab":
        e.preventDefault();
        this.uiEdges.terminalToggle = true;
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
          this.uiEdges.voiceReleased = true;
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

  // UI edges drain every frame (toggles, holds)
  consumeUiEdges(): UiEdges {
    const out = { ...this.uiEdges };
    this.uiEdges.chatToggle = false;
    this.uiEdges.terminalToggle = false;
    this.uiEdges.flashlightToggle = false;
    this.uiEdges.voicePressed = false;
    this.uiEdges.voiceReleased = false;
    return out;
  }

  // Net edges drain only when input is transmitted, so they can never be lost
  // on a frame where we don't send.
  consumeNetEdges(): NetEdges {
    const out = { ...this.netEdges };
    this.netEdges.interact = false;
    this.netEdges.drop = false;
    return out;
  }

  forceRefocus(): void {
    if (this.uiHasFocus()) {
      this.state.mvx = 0;
      this.state.mvy = 0;
    } else {
      this.recomputeMove();
    }
  }
}
