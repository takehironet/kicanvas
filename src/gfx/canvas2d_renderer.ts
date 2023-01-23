/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { Renderer, RenderLayer, RenderStateStack } from "./renderer.js";
import { Matrix3 } from "../math/matrix3.js";
import { Arc, Circle, Polygon, Polyline } from "./primitives.js";
import { Color } from "./color.js";

/**
 * Canvas2d-based renderer.
 *
 * This renderer works by turning draw calls into DrawCommands - basically
 * serializing them as Path2D + state. These DrawCommands are combined into
 * multiple Layers. When the layers are later drawn, the draw commands are
 * stepped through and draw onto the canvas.
 *
 * This is similar to generating old-school display lists.
 *
 */
export class Canvas2DRenderer extends Renderer {
    /** Graphics layers */
    #layers: Canvas2dRenderLayer[] = [];

    /** The layer currently being drawn to. */
    #active_layer: Canvas2dRenderLayer = null;

    /** State */
    state: RenderStateStack = new RenderStateStack();

    ctx2d: CanvasRenderingContext2D;

    /**
     * Create a new Canvas2DRenderer
     */
    constructor(canvas: HTMLCanvasElement) {
        super(canvas);
    }

    /**
     * Create and configure the 2D Canvas context.
     */
    async setup() {
        await super.setup();

        // just in case the browser still gives us a backbuffer with alpha,
        // set the background color of the canvas to black so that it behaves
        // correctly.
        this.canvas.style.backgroundColor = this.background_color.to_css();

        const ctx2d = this.canvas.getContext("2d", { alpha: false });

        if (ctx2d == null) {
            throw new Error("Unable to create Canvas2d context");
        }

        this.ctx2d = ctx2d;
        this.set_viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    set_viewport(x: number, y: number, w: number, h: number) {
        const dpr = window.devicePixelRatio;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = Math.round(rect.width * dpr);
        this.canvas.height = Math.round(rect.height * dpr);
        this.ctx2d.setTransform();
    }

    clear_canvas() {
        this.ctx2d.setTransform();
        this.ctx2d.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.ctx2d.fillStyle = this.background_color.to_css();
        this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx2d.lineCap = "round";
        this.ctx2d.lineJoin = "round";
    }

    start_layer(name: string, depth = 0) {
        this.#active_layer = new Canvas2dRenderLayer(this, name, depth);
    }

    end_layer(): RenderLayer {
        if (this.#active_layer == null) throw new Error("No active layer");

        this.#layers.push(this.#active_layer);
        this.#active_layer = null;

        return this.#layers.at(-1);
    }

    circle(circle: Circle) {
        super.circle(circle);

        if (!circle.color) {
            return;
        }

        const color = (circle.color as Color).to_css();

        const path = new Path2D();
        path.arc(
            circle.center.x,
            circle.center.y,
            circle.radius,
            0,
            Math.PI * 2
        );

        this.#active_layer.commands.push(new DrawCommand(path, color, null, 0));
    }

    arc(arc: Arc) {
        super.arc(arc);

        if (!arc.color) {
            return;
        }

        const color = (arc.color as Color).to_css();

        const path = new Path2D();
        path.arc(
            arc.center.x,
            arc.center.y,
            arc.radius,
            arc.start_angle.radians,
            arc.end_angle.radians
        );

        this.#active_layer.commands.push(
            new DrawCommand(path, null, color, arc.width)
        );
    }

    line(line: Polyline) {
        super.line(line);

        if (!line.color) {
            return;
        }

        const color = (line.color as Color).to_css();

        const path = new Path2D();
        let started = false;

        for (const point of line.points) {
            if (!started) {
                path.moveTo(point.x, point.y);
                started = true;
            } else {
                path.lineTo(point.x, point.y);
            }
        }

        this.#active_layer.commands.push(
            new DrawCommand(path, null, color, line.width)
        );
    }

    polygon(polygon: Polygon) {
        super.polygon(polygon);

        if (!polygon.color) {
            return;
        }

        const color = (polygon.color as Color).to_css();

        const path = new Path2D();
        let started = false;

        for (const point of polygon.points) {
            if (!started) {
                path.moveTo(point.x, point.y);
                started = true;
            } else {
                path.lineTo(point.x, point.y);
            }
        }
        path.closePath();

        this.#active_layer.commands.push(new DrawCommand(path, color, null, 0));
    }

    get layers() {
        const layers = this.#layers;
        return {
            *[Symbol.iterator]() {
                for (const layer of layers) {
                    yield layer;
                }
            },
        };
    }
}

class DrawCommand {
    constructor(
        public path: Path2D,
        public fill: string | null,
        public stroke: string | null,
        public stroke_width: number
    ) {}

    draw(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = this.fill;
        ctx.strokeStyle = this.stroke;
        ctx.lineWidth = this.stroke_width;
        if (this.fill) {
            ctx.fill(this.path);
        }
        if (this.stroke) {
            ctx.stroke(this.path);
        }
    }
}

class Canvas2dRenderLayer extends RenderLayer {
    constructor(
        public readonly renderer: Renderer,
        public readonly name: string,
        public readonly depth: number = 0,
        public commands: DrawCommand[] = []
    ) {
        super(renderer, name, depth);
    }

    clear() {
        this.commands = [];
    }

    draw(transform: Matrix3) {
        const ctx = (this.renderer as Canvas2DRenderer).ctx2d;
        ctx.save();

        const accumulated_transform = Matrix3.from_DOMMatrix(
            ctx.getTransform()
        );
        accumulated_transform.multiply_self(transform);
        ctx.setTransform(accumulated_transform.to_DOMMatrix());

        for (const command of this.commands) {
            command.draw(ctx);
        }

        ctx.restore();
    }
}
