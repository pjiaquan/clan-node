import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

const PersonNode = memo(({ data, selected }: NodeProps) => {
  return (
    <>
      <Handle type="target" position={Position.Top} id="top-t" />
      <Handle type="source" position={Position.Top} id="top-s" />
      
      <Handle type="target" position={Position.Right} id="right-t" />
      <Handle type="source" position={Position.Right} id="right-s" />
      
      <Handle type="target" position={Position.Bottom} id="bottom-t" />
      <Handle type="source" position={Position.Bottom} id="bottom-s" />
      
      <Handle type="target" position={Position.Left} id="left-t" />
      <Handle type="source" position={Position.Left} id="left-s" />

      <div
        className={`person-node ${selected ? 'selected' : ''} ${data.isCenter ? 'center' : ''} ${data.flashCenter ? 'center-flash' : ''}`}
        style={{ borderColor: selected ? '#667eea' : data.genderColor }}
      >
        <div
          className="node-avatar"
          style={{ background: data.genderColor }}
          onClick={(event) => {
            if (!data.onAvatarClick) return;
            event.stopPropagation();
            data.onAvatarClick();
          }}
        >
          {data.avatarUrl ? (
            <img src={data.avatarUrl} alt={data.name} />
          ) : (
            data.initial
          )}
        </div>
        <div className="node-name">{data.name}</div>
        {data.title && <div className="node-title">{data.title}</div>}
      </div>
    </>
  );
});

export default PersonNode;
