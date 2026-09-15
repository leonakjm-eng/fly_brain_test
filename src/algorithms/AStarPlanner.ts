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

    // Compute max height from obstacles to ensure raycast starts above all obstacles
    let maxY = 10;
    if (staticObstacles.length > 0) {
      const allObstaclesGroup = new THREE.Group();
      staticObstacles.forEach(o => allObstaclesGroup.add(o.clone()));
      const obBox = new THREE.Box3().setFromObject(allObstaclesGroup);
      if (isFinite(obBox.max.y)) {
        maxY = obBox.max.y + 1;
      }
    }

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

    // Raycaster for checking if a cell is blocked by an obstacle
    const raycaster = new THREE.Raycaster();

    for (let x = 0; x < this.gridWidth; x++) {
      this.grid[x] = [];
      for (let z = 0; z < this.gridDepth; z++) {
        const worldX = this.minX + x * CONSTANTS.GRID_RESOLUTION + CONSTANTS.GRID_RESOLUTION / 2;
        const worldZ = this.minZ + z * CONSTANTS.GRID_RESOLUTION + CONSTANTS.GRID_RESOLUTION / 2;

        let walkable = true;

        // Raycast down from above the cell to see if it hits an obstacle
        const origin = new THREE.Vector3(worldX, maxY, worldZ);
        raycaster.set(origin, new THREE.Vector3(0, -1, 0));

        if (staticObstacles.length > 0) {
          const intersects = raycaster.intersectObjects(staticObstacles, true);
          const validIntersects = intersects.filter(hit =>
            hit.object.userData.isStatic === true || hit.object.userData.isObstacle
          );

          if (validIntersects.length > 0) {
             walkable = false;
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
    const inflatedNodes = new Set<GridNode>();

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
                  const dist = Math.hypot(neighbor.worldX - node.worldX, neighbor.worldZ - node.worldZ);
                  if (dist <= ROBOT_RADIUS) {
                    inflatedNodes.add(neighbor);
                  }
                }
              }
            }
          }
        }
      }
    }

    inflatedNodes.forEach(node => node.walkable = false);
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

  public findPath(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
    const startNode = this.getNodeFromWorld(start);
    const targetNode = this.getNodeFromWorld(end);

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
