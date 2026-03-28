"""Data processors for ProtSpace.

- BaseProcessor: Core dimensionality reduction and output creation
- ReductionPipeline: Unified pipeline composing loaders + DR + output
"""

from protspace.data.processors.base_processor import BaseProcessor
from protspace.data.processors.pipeline import PipelineConfig, ReductionPipeline

__all__ = ["BaseProcessor", "PipelineConfig", "ReductionPipeline"]
