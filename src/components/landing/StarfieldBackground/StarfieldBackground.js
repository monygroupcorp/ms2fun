import { Component } from "../../../core/Component.js";

export class StarfieldBackground extends Component {
    static styles = `
        .starfield-canvas {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, #0f0f1a, #1a1a2f);
            z-index: -1;
            border: 1px solid red;
        }
    `;

    constructor() {
        super();
        this.state = {
            stars: [],
            mouseX: 0,
            mouseY: 0
        };
        this.animationFrame = null;
    }

    template() {
        return `
            <canvas class="starfield-canvas"></canvas>
        `;
    }

    onMount() {
        console.log('StarfieldBackground mounted');
        this.canvas = this.element.querySelector('.starfield-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Set explicit dimensions
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Draw a test pattern
        console.log('Drawing test pattern...');
        
        // Draw background
        this.ctx.fillStyle = '#0f0f1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw a big white circle in the center
        this.ctx.beginPath();
        this.ctx.arc(
            this.canvas.width / 2,
            this.canvas.height / 2,
            50,
            0,
            Math.PI * 2
        );
        this.ctx.fillStyle = 'white';
        this.ctx.fill();
        
        // Draw some test dots
        const testDots = [
            {x: 100, y: 100},
            {x: 200, y: 200},
            {x: 300, y: 300}
        ];
        
        testDots.forEach(dot => {
            this.ctx.beginPath();
            this.ctx.arc(dot.x, dot.y, 10, 0, Math.PI * 2);
            this.ctx.fillStyle = 'red';
            this.ctx.fill();
        });
        
        console.log('Test pattern complete');
    }

    onUnmount() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        window.removeEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const pixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * pixelRatio;
        this.canvas.height = window.innerHeight * pixelRatio;
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.scale(pixelRatio, pixelRatio);
    }

    initStars() {
        const stars = [];
        // Create fewer stars initially
        for (let i = 0; i < 50; i++) {
            stars.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                size: Math.random() * 2 + 1, // Size between 1-3
                brightness: Math.random() * 0.5 + 0.5 // Brightness between 0.5-1
            });
        }
        this.setState({ stars });
    }

    animate() {
        // Clear the canvas
        this.ctx.fillStyle = 'rgba(15, 15, 26, 0.3)'; // Slight trail effect
        this.ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        
        // Draw each star
        this.state.stars.forEach(star => {
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
            this.ctx.fill();
        });

        this.animationFrame = requestAnimationFrame(() => this.animate());
    }
}