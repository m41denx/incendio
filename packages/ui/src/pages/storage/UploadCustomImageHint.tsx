import type { FC } from "react";

const UploadCustomImageHint: FC = () => {
  return (
    <>
      <div className={`p-notification--information`}>
        <div className="p-notification__content">
          <h3 className="p-notification__title">
            Some image formats need to be modified in order to work with Incus.
          </h3>
        </div>
      </div>
    </>
  );
};

export default UploadCustomImageHint;
