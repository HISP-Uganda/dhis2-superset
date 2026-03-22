# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""GeoJSON utilities for DHIS2 boundary data."""
import json
import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _detect_coordinate_nesting_depth(coords: Any) -> int:
    """
    Detect the nesting depth of coordinates to determine actual geometry type.

    DHIS2 sometimes mislabels geometry types (e.g., ty=2 for Polygon but coords are
    actually MultiPolygon format with 4 levels of nesting).

    Nesting depth meanings:
    - 1: Point [lng, lat]
    - 2: LineString [[lng, lat], ...]
    - 3: Polygon [[[lng, lat], ...]]
    - 4: MultiPolygon [[[[lng, lat], ...]]]

    Args:
        coords: Parsed coordinates

    Returns:
        Nesting depth (1-4+)
    """
    if not isinstance(coords, list) or len(coords) == 0:
        return 0

    depth = 1
    current = coords
    while isinstance(current, list) and len(current) > 0:
        first_element = current[0]
        if isinstance(first_element, (int, float)):
            # Found a number, this is the coordinate level
            return depth
        elif isinstance(first_element, list):
            depth += 1
            current = first_element
        else:
            break

    return depth


def convert_to_geojson(geo_features: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Convert DHIS2 geoFeatures response to standard GeoJSON FeatureCollection.

    DHIS2 geoFeatures format:
    - ty: 1=Point, 2=Polygon, 3=MultiPolygon
    - co: JSON string of coordinates in [lng, lat] format

    GeoJSON format expects coordinates as:
    - Point: [lng, lat]
    - Polygon: [[[lng, lat], [lng, lat], ...]]
    - MultiPolygon: [[[[lng, lat], [lng, lat], ...], ...]]

    Note: DHIS2 sometimes reports ty=2 (Polygon) but sends coordinates in
    MultiPolygon format (4 levels of nesting). This function detects the actual
    nesting depth and uses the correct geometry type.

    Args:
        geo_features: List of geoFeature objects from DHIS2

    Returns:
        GeoJSON FeatureCollection dictionary
    """
    features = []
    logger.info(f"[convert_to_geojson] Processing {len(geo_features)} geo features")

    for gf in geo_features:
        feature_name = gf.get("na", gf.get("id", "unknown"))
        feature_id = gf.get("id", "unknown")

        try:
            raw_coords = gf.get("co", "[]")
            if isinstance(raw_coords, str):
                coordinates = json.loads(raw_coords)
            else:
                coordinates = raw_coords
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse coordinates for feature {feature_name} ({feature_id}): {e}")
            continue  # Skip features with invalid coordinates

        # Skip if no valid coordinates
        if not coordinates:
            logger.info(f"No coordinates for feature {feature_name} ({feature_id})")
            continue

        # Get the declared type from DHIS2
        geo_type_num = gf.get("ty", 2)
        declared_type = {
            1: "Point",
            2: "Polygon",
            3: "MultiPolygon",
        }.get(geo_type_num, "Polygon")

        # Detect actual nesting depth to determine true geometry type
        # This handles cases where DHIS2 says ty=2 (Polygon) but coords are MultiPolygon format
        nesting_depth = _detect_coordinate_nesting_depth(coordinates)

        # Determine actual geometry type based on nesting depth
        if nesting_depth == 1:
            geo_type = "Point"
        elif nesting_depth == 3:
            geo_type = "Polygon"
        elif nesting_depth == 4:
            geo_type = "MultiPolygon"
        elif nesting_depth == 2:
            # Could be LineString or improperly formatted Polygon
            geo_type = declared_type if declared_type in ("Point", "LineString") else "Polygon"
        else:
            geo_type = declared_type

        # Log if there's a mismatch between declared and detected types
        if geo_type != declared_type:
            logger.info(
                f"Feature {feature_name} ({feature_id}): DHIS2 declared type={declared_type} (ty={geo_type_num}), "
                f"but detected nesting depth={nesting_depth}, using type={geo_type}"
            )
        else:
            logger.debug(
                f"Feature {feature_name} ({feature_id}): type={geo_type}, nesting_depth={nesting_depth}"
            )

        # Validate and fix coordinate structure
        try:
            validated_coords = _validate_coordinates(coordinates, geo_type)
            if validated_coords is None:
                logger.warning(
                    f"Invalid coordinates structure for {feature_name} ({feature_id}), "
                    f"geo_type={geo_type}, coords_type={type(coordinates).__name__}, "
                    f"coords_len={len(coordinates) if isinstance(coordinates, list) else 'N/A'}, "
                    f"nesting_depth={nesting_depth}"
                )
                continue
        except Exception as e:
            logger.warning(f"Error validating coordinates for {feature_name} ({feature_id}): {e}")
            continue

        feature = {
            "type": "Feature",
            "id": gf.get("id"),
            "properties": {
                "id": gf.get("id"),
                "name": gf.get("na"),
                "level": gf.get("le"),
                "parentId": gf.get("pi"),
                "parentName": gf.get("pn"),
                "hasChildrenWithCoordinates": gf.get("hcd", False),
                "hasParentWithCoordinates": gf.get("hcu", False),
            },
            "geometry": {
                "type": geo_type,
                "coordinates": validated_coords,
            },
        }
        features.append(feature)

    logger.info(
        f"[convert_to_geojson] Converted {len(features)} of {len(geo_features)} features to GeoJSON"
    )

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def _validate_coordinates(coords: Any, geo_type: str) -> Any:
    """
    Validate and fix coordinate structure for GeoJSON.

    DHIS2 sometimes returns coordinates in unexpected formats:
    - Flat arrays: [lng1, lat1, lng2, lat2, ...] instead of [[lng1, lat1], [lng2, lat2], ...]
    - Missing nesting levels

    Args:
        coords: Raw coordinates from DHIS2
        geo_type: GeoJSON geometry type (Point, Polygon, MultiPolygon)

    Returns:
        Properly structured coordinates or None if invalid
    """
    if coords is None:
        return None

    if geo_type == "Point":
        # Point should be [lng, lat]
        if isinstance(coords, list) and len(coords) >= 2:
            if isinstance(coords[0], (int, float)):
                return [float(coords[0]), float(coords[1])]
        return None

    elif geo_type == "Polygon":
        # Polygon should be [[[lng, lat], [lng, lat], ...]]
        # Check if it's already properly nested
        if _is_valid_polygon(coords):
            return coords
        # Try to fix single ring without outer array
        if _is_valid_ring(coords):
            return [coords]
        # Try to fix flat array of coordinates
        fixed = _fix_flat_coordinates(coords)
        if fixed and _is_valid_polygon([fixed]):
            return [fixed]
        return None

    elif geo_type == "MultiPolygon":
        # MultiPolygon should be [[[[lng, lat], ...]]]
        if _is_valid_multi_polygon(coords):
            return coords
        # Try to convert from Polygon format
        if _is_valid_polygon(coords):
            return [coords]
        # Try to fix flat array
        fixed = _fix_flat_coordinates(coords)
        if fixed and _is_valid_ring(fixed):
            return [[fixed]]
        return None

    return coords


def _fix_flat_coordinates(coords: Any) -> list | None:
    """
    Try to convert a flat array of numbers into coordinate pairs.

    DHIS2 sometimes returns [lng1, lat1, lng2, lat2, ...] instead of
    [[lng1, lat1], [lng2, lat2], ...]

    Args:
        coords: Potentially flat coordinate array

    Returns:
        Array of coordinate pairs or None if invalid
    """
    if not isinstance(coords, list):
        return None

    # Check if this is a flat array of numbers
    if len(coords) >= 4 and all(isinstance(c, (int, float)) for c in coords):
        # Convert flat array to coordinate pairs
        pairs = []
        for i in range(0, len(coords) - 1, 2):
            lng = float(coords[i])
            lat = float(coords[i + 1])
            # Validate coordinate ranges
            if -180 <= lng <= 180 and -90 <= lat <= 90:
                pairs.append([lng, lat])
            else:
                return None
        if len(pairs) >= 3:  # Minimum for a valid ring
            return pairs
    return None


def _is_valid_coord_pair(coord: Any) -> bool:
    """Check if coord is a valid [lng, lat] pair."""
    return (
        isinstance(coord, list) and
        len(coord) >= 2 and
        isinstance(coord[0], (int, float)) and
        isinstance(coord[1], (int, float))
    )


def _is_valid_ring(coords: Any) -> bool:
    """Check if coords is a valid ring (array of coord pairs)."""
    if not isinstance(coords, list) or len(coords) < 3:
        return False
    return all(_is_valid_coord_pair(c) for c in coords)


def _is_valid_polygon(coords: Any) -> bool:
    """Check if coords is a valid Polygon (array of rings)."""
    if not isinstance(coords, list) or len(coords) < 1:
        return False
    return all(_is_valid_ring(ring) for ring in coords)


def _is_valid_multi_polygon(coords: Any) -> bool:
    """Check if coords is a valid MultiPolygon (array of polygons)."""
    if not isinstance(coords, list) or len(coords) < 1:
        return False
    return all(_is_valid_polygon(poly) for poly in coords)


def build_ou_parameter(level: int | None, parent: str | None) -> str:
    """
    Build organisation unit parameter for DHIS2 geoFeatures API.

    The geoFeatures API accepts different forms depending on the query style:
    - ou=ou:LEVEL-n: Returns org units at level n
    - ou=<UID>: Returns a specific parent org unit boundary

    For the boundary endpoint, a parent selection takes precedence over level
    scoping because callers use the parent branch to fetch the exact selected
    org unit boundary. Level-only calls still use the explicit ``ou:LEVEL-n``
    syntax expected by DHIS2.

    Args:
        level: Organisation unit level (1-6)
        parent: Parent organisation unit UID

    Returns:
        Properly formatted OU parameter string for geoFeatures API
    """
    if parent:
        return parent
    if level:
        # Level only - return all org units at that level
        return f"ou:LEVEL-{level}"
    # No parameters - return user org units
    return "ou:USER_ORGUNIT"
