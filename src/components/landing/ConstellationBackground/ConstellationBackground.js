import { Component } from '../../../core/Component.js';

export class ConstellationBackground extends Component {
    constructor(rootElement) {
        super(rootElement);
        this.state = {
            stars: [],
            mousePosition: { x: 0, y: 0 },
            connectionRadius: 150
        };
        this.canvas = null;
        this.ctx = null;
        this.animationFrame = null;
    }

    static styles = `
        .constellation-background {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            background: linear-gradient(to bottom, #0f0f1a, #1a1a2e);
        }
    `;

    template() {
        return `
            <canvas class="constellation-background"></canvas>
        `;
    }

    events() {
        return {
            'mousemove': this.handleMouseMove.bind(this),
            'touchmove': this.handleTouchMove.bind(this)
        };
    }

    onMount() {
        this.canvas = this.element.querySelector('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.initStars();
        this.animate();

        window.addEventListener('resize', this.resizeCanvas.bind(this));
    }

    onUnmount() {
        window.removeEventListener('resize', this.resizeCanvas.bind(this));
        cancelAnimationFrame(this.animationFrame);
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.initStars(); // Recreate stars when canvas is resized
    }

    initStars() {
        const stars = [];
        const numStars = Math.floor((this.canvas.width * this.canvas.height) / 10000);
        
        for (let i = 0; i < numStars; i++) {
            stars.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                radius: Math.random() * 2 + 1,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                alpha: Math.random()
            });
        }

        this.setState({ stars });
    }

    handleMouseMove(e) {
        this.setState({
            mousePosition: {
                x: e.clientX,
                y: e.clientY
            }
        });
    }

    handleTouchMove(e) {
        if (e.touches.length > 0) {
            this.setState({
                mousePosition: {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                }
            });
        }
    }

    drawStar(star) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        ctx.fill();
    }

    drawConnections() {
        const ctx = this.ctx;
        const { stars, mousePosition, connectionRadius } = this.state;

        ctx.strokeStyle = 'rgba(255, 105, 180, 0.15)'; // Remilia pink
        ctx.lineWidth = 0.5;

        stars.forEach((star, i) => {
            // Connect to mouse if within radius
            const mouseDistance = Math.hypot(star.x - mousePosition.x, star.y - mousePosition.y);
            if (mouseDistance < connectionRadius) {
                const alpha = (1 - mouseDistance / connectionRadius) * 0.5;
                ctx.beginPath();
                ctx.strokeStyle = `rgba(255, 105, 180, ${alpha})`;
                ctx.moveTo(star.x, star.y);
                ctx.lineTo(mousePosition.x, mousePosition.y);
                ctx.stroke();
            }

            // Connect to nearby stars
            for (let j = i + 1; j < stars.length; j++) {
                const star2 = stars[j];
                const distance = Math.hypot(star.x - star2.x, star.y - star2.y);
                
                if (distance < connectionRadius) {
                    const alpha = (1 - distance / connectionRadius) * 0.2;
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(255, 105, 180, ${alpha})`;
                    ctx.moveTo(star.x, star.y);
                    ctx.lineTo(star2.x, star2.y);
                    ctx.stroke();
                }
            }
        });
    }

    updateStars() {
        const { stars } = this.state;
        stars.forEach(star => {
            star.x += star.vx;
            star.y += star.vy;
            star.alpha = Math.sin(Date.now() / 1000 + star.x) * 0.3 + 0.7;

            // Wrap around edges
            if (star.x < 0) star.x = this.canvas.width;
            if (star.x > this.canvas.width) star.x = 0;
            if (star.y < 0) star.y = this.canvas.height;
            if (star.y > this.canvas.height) star.y = 0;
        });
        this.setState({ stars });
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.updateStars();
        this.state.stars.forEach(star => this.drawStar(star));
        this.drawConnections();
        
        this.animationFrame = requestAnimationFrame(this.animate.bind(this));
    }
}