"""The shape check and the white edge, on synthetic masks — no models needed.

    python -m unittest tools/cutout/test_cutout.py
"""

import unittest

import numpy as np

from cutout import level, shape_check, unmix_white


def rect(h, w, y0, y1, x0, x1):
    mask = np.zeros((h, w), np.float32)
    mask[y0:y1, x0:x1] = 1.0
    return mask


class ShapeCheck(unittest.TestCase):
    def test_a_whole_pack_is_left_alone(self):
        mask = rect(200, 160, 20, 180, 20, 140)
        alpha, report = shape_check(mask)
        self.assertEqual(report["dents"], [])
        self.assertEqual(report["holes"], 0.0)
        np.testing.assert_allclose(alpha, mask)

    def test_an_enclosed_hole_is_filled(self):
        mask = rect(200, 160, 20, 180, 20, 140)
        mask[80:120, 60:100] = 0.0  # a printed white panel the model dropped
        alpha, report = shape_check(mask)
        self.assertGreater(report["holes"], 0.05)
        self.assertTrue((alpha[85:115, 65:95] > 0.99).all())

    def test_a_deep_bite_into_a_box_is_filled_and_the_box_restored(self):
        # As on the Lavazza Intenso box: the model cut round a printed cup up
        # from the bottom edge, and never reached the bottom-right corner.
        mask = rect(200, 160, 20, 180, 20, 140)
        mask[80:180, 50:120] = 0.0
        mask[160:180, 125:140] = 0.0
        alpha, report = shape_check(mask)
        self.assertEqual(len(report["dents"]), 1)
        self.assertGreater(report["dents"][0]["depth"], 0.30)
        self.assertGreater(report["box"], 0.90)
        self.assertTrue((alpha[90:170, 60:110] > 0.99).all())
        self.assertTrue((alpha[163:175, 128:136] > 0.99).all())  # the corner, back

    def test_a_shallow_gap_beside_a_round_badge_stays_a_gap(self):
        mask = rect(200, 200, 40, 180, 20, 150)
        yy, xx = np.mgrid[0:200, 0:200]
        mask[(yy - 45) ** 2 + (xx - 155) ** 2 < 30 ** 2] = 1.0  # an "x100" badge on the corner
        alpha, report = shape_check(mask)
        self.assertEqual(report["dents"], [])
        self.assertLess(alpha[15, 60], 0.01)  # the ground above the pouch stays ground


class Edge(unittest.TestCase):
    def test_white_is_unmixed_from_a_soft_edge(self):
        red = np.array([200.0, 30.0, 30.0])
        a = 0.5
        mixed = a * red + (1 - a) * 255.0
        out = unmix_white(mixed.reshape(1, 1, 3), np.array([[a]]))
        np.testing.assert_allclose(out[0, 0], red, atol=0.5)

    def test_the_ground_is_levelled_and_the_canvas_cropped(self):
        canvas = np.full((120, 80, 3), 255.0)
        canvas[30:90, 10:70] = 246.0  # the photo's light-grey ground
        canvas[50:70, 30:50] = [120.0, 60.0, 20.0]  # the pack
        out = level(canvas)
        self.assertLess(out.shape[0], 120)
        self.assertAlmostEqual(float(out[15, 15].mean()), 255.0, delta=0.5)


if __name__ == "__main__":
    unittest.main()
