import pytest
import numpy as np
import pandas as pd
from unittest.mock import patch, MagicMock
from pathlib import Path
import pyarrow as pa

from src.protspace.data.base_data_processor import BaseDataProcessor

# Sample data for tests
SAMPLE_CONFIG = {'n_neighbors': 5, 'custom_names': {'pca2': 'CustomPCA'}}
SAMPLE_HEADERS = ['P1', 'P2', 'P3']
SAMPLE_DATA = np.array([[1.0, 0.5], [0.5, 1.0], [0.2, 0.8]])
SAMPLE_METADATA = pd.DataFrame({
    'identifier': SAMPLE_HEADERS,
    'length': ['100', '200', '300'],
    'organism': ['A', 'B', 'C']
})
SAMPLE_REDUCED = np.array([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
SAMPLE_REDUCTIONS = [
    {
        'name': 'PCA_2',
        'dimensions': 2,
        'info': {'n_components': 2},
        'data': SAMPLE_REDUCED
    }
]

class DummyReducer:
    def __init__(self, config):
        self.config = config
    def fit_transform(self, data):
        return SAMPLE_REDUCED
    def get_params(self):
        return {'n_components': 2}


class TestBaseDataProcessorInit:
    def test_init_sets_config_and_reducers(self):
        reducers = {'pca': DummyReducer}
        processor = BaseDataProcessor(SAMPLE_CONFIG, reducers)
        assert processor.config == SAMPLE_CONFIG
        assert processor.reducers == reducers
        assert processor.identifier_col == 'identifier'
        assert processor.custom_names == {'pca2': 'CustomPCA'}


class TestProcessReduction:
    def test_process_reduction_success(self):
        reducers = {'pca': DummyReducer}
        processor = BaseDataProcessor(SAMPLE_CONFIG, reducers)
        result = processor.process_reduction(SAMPLE_DATA, 'pca', 2)
        assert result['name'] == 'CustomPCA'
        assert result['dimensions'] == 2
        assert result['info'] == {'n_components': 2}
        np.testing.assert_array_equal(result['data'], SAMPLE_REDUCED)

    def test_process_reduction_unknown_method(self):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {})
        with pytest.raises(ValueError, match='Unknown reduction method: umap'):
            processor.process_reduction(SAMPLE_DATA, 'umap', 2)

    def test_process_reduction_mds_precomputed(self):
        # Test special handling for MDS with precomputed similarity
        config = {'precomputed': True}
        reducers = {'mds': DummyReducer}
        processor = BaseDataProcessor(config, reducers)
        # Diagonal is all 1, triggers similarity-to-distance
        data = np.eye(3)
        result = processor.process_reduction(data, 'mds', 2)
        np.testing.assert_array_equal(result['data'], SAMPLE_REDUCED)


class TestCreateOutput:
    def test_create_output_tables(self):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {'pca': DummyReducer})
        reductions = SAMPLE_REDUCTIONS
        tables = processor.create_output(SAMPLE_METADATA, reductions, SAMPLE_HEADERS)
        assert set(tables.keys()) == {'protein_features', 'projections_metadata', 'projections_data'}
        assert isinstance(tables['protein_features'], pa.Table)
        assert isinstance(tables['projections_metadata'], pa.Table)
        assert isinstance(tables['projections_data'], pa.Table)

    def test_create_output_legacy(self):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {'pca': DummyReducer})
        reductions = SAMPLE_REDUCTIONS
        output = processor.create_output_legacy(SAMPLE_METADATA, reductions, SAMPLE_HEADERS)
        assert 'protein_data' in output
        assert 'projections' in output
        assert set(output['protein_data'].keys()) == set(SAMPLE_HEADERS)
        assert isinstance(output['projections'], list)
        assert output['projections'][0]['name'] == 'PCA_2' or output['projections'][0]['name'] == 'CustomPCA'


class TestSaveOutput:
    @patch('src.protspace.data.base_data_processor.pq.write_table')
    def test_save_output_separate_files(self, mock_write_table):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {'pca': DummyReducer})
        tables = processor.create_output(SAMPLE_METADATA, SAMPLE_REDUCTIONS, SAMPLE_HEADERS)
        with patch('pathlib.Path.mkdir') as mock_mkdir:
            processor.save_output(tables, Path('output_dir'), bundled=False)
            assert mock_write_table.call_count == 3
            mock_mkdir.assert_called()

    @patch('src.protspace.data.base_data_processor.pq.write_table')
    def test_save_output_bundled(self, mock_write_table):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {'pca': DummyReducer})
        tables = processor.create_output(SAMPLE_METADATA, SAMPLE_REDUCTIONS, SAMPLE_HEADERS)
        with patch('pathlib.Path.mkdir') as mock_mkdir, \
             patch('builtins.open', new_callable=MagicMock) as mock_open:
            processor.save_output(tables, Path('output_dir'), bundled=True)
            mock_mkdir.assert_called()
            mock_open.assert_called()

    @patch('json.dump')
    def test_save_output_legacy(self, mock_json_dump):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {'pca': DummyReducer})
        output = processor.create_output_legacy(SAMPLE_METADATA, SAMPLE_REDUCTIONS, SAMPLE_HEADERS)
        with patch('pathlib.Path.mkdir') as mock_mkdir, \
             patch('pathlib.Path.open', new_callable=MagicMock) as mock_open, \
             patch('pathlib.Path.exists', return_value=False):
            processor.save_output_legacy(output, Path('output_dir'))
            mock_mkdir.assert_called()
            mock_open.assert_called()
            mock_json_dump.assert_called() 