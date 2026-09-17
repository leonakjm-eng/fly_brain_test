import * as THREE from 'three';
import { CONSTANTS } from '../types/constants';

interface GridNode {
  x: number;
  z: number;
  worldX: number;
  worldZ: number;
  walkable: boolean;
  gCost: number;
  hCost: number;
  fCost: number;
  parent: GridNode | null;
}

export class AStarPlanner {
  private grid: GridNode[][] = [];
  private gridWidth = 0;
  private gridDepth = 0;
  private minX = 0;
  private minZ = 0;

  public buildGridFromScene(walkableMesh: THREE.Mesh, obstacles: THREE.Object3D[]): void {
    const box = new THREE.Box3().setFromObject(walkableMesh);

    // Filter out dynamic obstacles at the entry point for optimization
    const staticObstacles = obstacles.filter(o => o.userData.isDynamic !== true);

    // Cache AABB of all valid meshes within obstacles
    const obstacleBoxes: THREE.Box3[] = [];
    staticObstacles.forEach(obs => {
      obs.traverse((child) => {
        if (child instanceof THREE.Mesh && (child.userData.isStatic || child.userData.isObstacle)) {
          const meshBox = new THREE.Box3().setFromObject(child);
          if (!meshBox.isEmpty()) {
            obstacleBoxes.push(meshBox);
          }
        }
      });
    });

    // In case the bounding box is invalid or infinite
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) {
      return;
    }

    this.minX = box.min.x;
    this.minZ = box.min.z;
    const width = box.max.x - box.min.x;
    const depth = box.max.z - box.min.z;

    this.gridWidth = Math.ceil(width / CONSTANTS.GRID_RESOLUTION);
    this.gridDepth = Math.ceil(depth / CONSTANTS.GRID_RESOLUTION);
    this.grid = [];

    const cellHalfW = CONSTANTS.GRID_RESOLUTION / 2;
    const cellHalfH = 2.0 / 2; // Height 2.0m

    // Scratch variables for memory leak prevention
    const cellMin = new THREE.Vector3();
    const cellMax = new THREE.Vector3();
    const cellBox = new THREE.Box3();

    for (let x = 0; x < this.gridWidth; x++) {
      this.grid[x] = [];
      for (let z = 0; z < this.gridDepth; z++) {
        const worldX = this.minX + x * CONSTANTS.GRID_RESOLUTION + cellHalfW;
        const worldZ = this.minZ + z * CONSTANTS.GRID_RESOLUTION + cellHalfW;
        const worldY = 1.0; // center at height 1.0m to span 0.0 to 2.0

        let walkable = true;

        cellMin.set(worldX - cellHalfW, worldY - cellHalfH, worldZ - cellHalfW);
        cellMax.set(worldX + cellHalfW, worldY + cellHalfH, worldZ + cellHalfW);
        cellBox.set(cellMin, cellMax);

        for (const obsBox of obstacleBoxes) {
          if (cellBox.intersectsBox(obsBox)) {
            walkable = false;
            break;
          }
        }

        this.grid[x][z] = {
          x, z,
          worldX, worldZ,
          walkable,
          gCost: 0,
          hCost: 0,
          fCost: 0,
          parent: null
        };
      }
    }

    // 2nd Inflation Pass
    const ROBOT_RADIUS = 0.35;
    const nodesToInflate: GridNode[] = [];

    for (let x = 0; x < this.gridWidth; x++) {
      for (let z = 0; z < this.gridDepth; z++) {
        const node = this.grid[x][z];
        if (!node.walkable) {
          // Check 8 neighbors
          for (let nx = -1; nx <= 1; nx++) {
            for (let nz = -1; nz <= 1; nz++) {
              if (nx === 0 && nz === 0) continue;
              const checkX = x + nx;
              const checkZ = z + nz;

              if (checkX >= 0 && checkX < this.gridWidth && checkZ >= 0 && checkZ < this.gridDepth) {
                const neighbor = this.grid[checkX][checkZ];
                if (neighbor.walkable) {
                  // Calculate distance from obstacle cell boundary to neighbor cell center
                  const closestX = THREE.MathUtils.clamp(neighbor.worldX, node.worldX - cellHalfW, node.worldX + cellHalfW);
                  const closestZ = THREE.MathUtils.clamp(neighbor.worldZ, node.worldZ - cellHalfW, node.worldZ + cellHalfW);
                  const dist = Math.hypot(neighbor.worldX - closestX, neighbor.worldZ - closestZ);

                  if (dist <= ROBOT_RADIUS) {
                    // Safe zone logic
                    if (neighbor.worldZ <= 0.6 || neighbor.worldZ >= 21.4) {
                      // Do not inflate Safe Zone nodes
                    } else {
                      nodesToInflate.push(neighbor);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < nodesToInflate.length; i++) {
      nodesToInflate[i].walkable = false;
    }
  }

  private getNodeFromWorld(worldPos: THREE.Vector3): GridNode | null {
    if (this.gridWidth === 0 || this.gridDepth === 0) return null;

    const x = Math.floor((worldPos.x - this.minX) / CONSTANTS.GRID_RESOLUTION);
    const z = Math.floor((worldPos.z - this.minZ) / CONSTANTS.GRID_RESOLUTION);

    if (x >= 0 && x < this.gridWidth && z >= 0 && z < this.gridDepth) {
      return this.grid[x][z];
    }
    return null;
  }

  private getNeighbors(node: GridNode): GridNode[] {
    const neighbors: GridNode[] = [];
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && z === 0) continue;

        const checkX = node.x + x;
        const checkZ = node.z + z;

        if (checkX >= 0 && checkX < this.gridWidth && checkZ >= 0 && checkZ < this.gridDepth) {
          neighbors.push(this.grid[checkX][checkZ]);
        }
      }
    }
    return neighbors;
  }

  private getDistance(nodeA: GridNode, nodeB: GridNode): number {
    const dstX = Math.abs(nodeA.x - nodeB.x);
    const dstZ = Math.abs(nodeA.z - nodeB.z);

    if (dstX > dstZ) return 14 * dstZ + 10 * (dstX - dstZ);
    return 14 * dstX + 10 * (dstZ - dstX);
  }

    private findNearestWalkableNode(node: GridNode): GridNode | null {
    if (node.walkable) return node;

    let nearest: GridNode | null = null;
    let minDistance = Infinity;

    // Search 5x5 area (radius 2)
    for (let xOffset = -2; xOffset <= 2; xOffset++) {
      for (let zOffset = -2; zOffset <= 2; zOffset++) {
        if (xOffset === 0 && zOffset === 0) continue;

        const checkX = node.x + xOffset;
        const checkZ = node.z + zOffset;

        if (checkX >= 0 && checkX < this.gridWidth && checkZ >= 0 && checkZ < this.gridDepth) {
          const neighbor = this.grid[checkX][checkZ];
          if (neighbor.walkable) {
            // Euclidean distance
            const dist = Math.hypot(xOffset, zOffset);
            if (dist < minDistance) {
              minDistance = dist;
              nearest = neighbor;
            }
          }
        }
      }
    }

    return nearest;
  }

  public findPath(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
    let startNode = this.getNodeFromWorld(start);
    let targetNode = this.getNodeFromWorld(end);

    if (startNode && !startNode.walkable) {
        startNode = this.findNearestWalkableNode(startNode);
    }
    if (targetNode && !targetNode.walkable) {
        targetNode = this.findNearestWalkableNode(targetNode);
    }

    if (!startNode || !targetNode || !startNode.walkable || !targetNode.walkable) {
      return [];
    }

    // Reset grid costs and parents
    for (let x = 0; x < this.gridWidth; x++) {
      for (let z = 0; z < this.gridDepth; z++) {
        this.grid[x][z].gCost = 0;
        this.grid[x][z].hCost = 0;
        this.grid[x][z].fCost = 0;
        this.grid[x][z].parent = null;
      }
    }

    const openSet: GridNode[] = [];
    const closedSet = new Set<GridNode>();
    openSet.push(startNode);

    while (openSet.length > 0) {
      let currentNode = openSet[0];
      let currentIndex = 0;

      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].fCost < currentNode.fCost || (openSet[i].fCost === currentNode.fCost && openSet[i].hCost < currentNode.hCost)) {
          currentNode = openSet[i];
          currentIndex = i;
        }
      }

      openSet.splice(currentIndex, 1);
      closedSet.add(currentNode);

      if (currentNode === targetNode) {
        return this.retracePath(startNode, targetNode);
      }

      for (const neighbor of this.getNeighbors(currentNode)) {
        if (!neighbor.walkable || closedSet.has(neighbor)) {
          continue;
        }

        const newCostToNeighbor = currentNode.gCost + this.getDistance(currentNode, neighbor);
        if (newCostToNeighbor < neighbor.gCost || !openSet.includes(neighbor)) {
          neighbor.gCost = newCostToNeighbor;
          neighbor.hCost = this.getDistance(neighbor, targetNode);
          neighbor.fCost = neighbor.gCost + neighbor.hCost;
          neighbor.parent = currentNode;

          if (!openSet.includes(neighbor)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    return []; // Path not found
  }

  private retracePath(startNode: GridNode, endNode: GridNode): THREE.Vector3[] {
    const path: GridNode[] = [];
    let currentNode: GridNode | null = endNode;

    while (currentNode !== startNode && currentNode !== null) {
      path.push(currentNode);
      currentNode = currentNode.parent;
    }

    const waypoints = path.map(node => new THREE.Vector3(node.worldX, 0, node.worldZ));
    waypoints.reverse(); // Start to End
    return waypoints;
  }
}
